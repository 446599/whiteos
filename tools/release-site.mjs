import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateManifest, validateImage } from "../flash/core.mjs";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repoPattern = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;

async function boundedDownload(url, limit, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Release asset exceeds its size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function listStableReleases(repo, token) {
  if (!repoPattern.test(repo)) throw new Error("Invalid repository");
  const releases = [];
  for (let page = 1; ; page++) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const bytes = await boundedDownload(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, 8 * 1024 * 1024, headers);
    const records = JSON.parse(bytes.toString());
    if (!Array.isArray(records)) throw new Error("Invalid releases response");
    releases.push(...records.filter(release => !release.draft && !release.prerelease && TAG.test(release.tag_name)));
    if (records.length < 100) break;
  }
  return releases.sort((a, b) => {
    const left = a.tag_name.slice(1).split(".").map(BigInt);
    const right = b.tag_name.slice(1).split(".").map(BigInt);
    for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index] ? -1 : 1;
    return 0;
  });
}

export async function prepareReleaseSite({ repo, releases, output, root, download = boundedDownload }) {
  if (!repoPattern.test(repo)) throw new Error("Invalid repository");
  if (!releases.length) throw new Error("No stable firmware Release found");
  // Only explicitly public site files enter the deployment artifact.
  await mkdir(output, { recursive: true });
  for (const name of ["index.html", "styles.css", "script.js", "assets", "flash", "install", ".nojekyll", "README.md", "SCREENSHOT_CHECKLIST.md", "RELEASE_FORMAT.md"]) {
    await cp(path.join(root, name), path.join(output, name), { recursive: true });
  }
  await mkdir(path.join(output, "firmware"), { recursive: true });
  for (const name of ["README.md", "THIRD_PARTY_NOTICES.md", "licenses"]) {
    await cp(path.join(root, "firmware", name), path.join(output, "firmware", name), { recursive: true });
  }
  const entries = [];
  const usedTags = new Set();
  for (const release of releases) {
    const tag = release.tag_name;
    if (!TAG.test(tag) || release.draft || release.prerelease || usedTags.has(tag)) throw new Error("Invalid stable Release");
    usedTags.add(tag);
    const version = tag.slice(1);
    const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
    if (release.html_url !== releaseUrl || !Array.isArray(release.assets)) throw new Error("Release repository mismatch");
    const asset = name => {
      const matches = release.assets.filter(item => item.name === name);
      if (matches.length !== 1 || matches[0].state !== "uploaded") throw new Error(`${tag}: missing or duplicate ${name}`);
      const item = matches[0];
      const expected = `https://github.com/${repo}/releases/download/${tag}/${name}`;
      if (item.browser_download_url !== expected || !Number.isSafeInteger(item.size) || item.size <= 0) throw new Error(`${tag}: invalid asset ${name}`);
      return item;
    };
    const manifestAsset = asset("manifest.json");
    if (manifestAsset.size > 32768) throw new Error(`${tag}: manifest too large`);
    const manifestBytes = await download(manifestAsset.browser_download_url, 32768);
    if (manifestBytes.length !== manifestAsset.size) throw new Error(`${tag}: manifest size mismatch`);
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
    if (manifest.version !== version) throw new Error(`${tag}: manifest version mismatch`);
    const archive = asset(`whiteos-${version}.zip`);
    if (archive.size > 32 * 1024 * 1024) throw new Error(`${tag}: archive too large`);
    const files = new Map([["manifest.json", manifestBytes]]);
    for (const part of manifest.parts) {
      const filenames = { bootloader: "bootloader.bin", partitions: "partition-table.bin", application: "whiteos.bin" };
      if (part.file !== filenames[part.role]) throw new Error(`${tag}: unexpected image filename`);
      const item = asset(part.file);
      if (item.size !== part.size) throw new Error(`${tag}: asset size mismatch`);
      const bytes = await download(item.browser_download_url, part.size);
      if (bytes.length !== part.size || createHash("sha256").update(bytes).digest("hex") !== part.sha256) throw new Error(`${tag}: SHA-256 mismatch`);
      validateImage(bytes, part.role);
      files.set(part.file, bytes);
    }
    const folder = path.join(output, "firmware", "releases", tag);
    await mkdir(folder, { recursive: true });
    for (const [name, bytes] of files) await writeFile(path.join(folder, name), bytes);
    const entry = { tag, version, releaseUrl, archiveUrl: archive.browser_download_url,
      publishedAt: release.published_at, manifestPath: `releases/${tag}/manifest.json` };
    entries.push(entry);
    console.log(`Validated ${tag}: three images and manifest from Release assets`);
  }
  await writeFile(path.join(output, "firmware", "releases.json"), JSON.stringify({ schema: 1, latest: entries[0], releases: entries }, null, 2) + "\n");
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const repo = process.env.GITHUB_REPOSITORY || "446599/whiteos";
  const releases = await listStableReleases(repo, process.env.GH_TOKEN);
  await prepareReleaseSite({ repo, releases, root, output: path.resolve(root, process.argv[2] || "_site") });
}
