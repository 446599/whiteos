import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listStableReleases, prepareReleaseSite } from "../tools/release-site.mjs";
import { syntheticRelease } from "./flash-fixtures.mjs";

async function fixture(context) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "whiteos-release-site-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "source");
  for (const folder of ["assets", "flash", "install", "manual/assets", "dictionary/python", "dictionary/vendor", "firmware/licenses"]) await mkdir(path.join(root, folder), { recursive: true });
  for (const file of ["index.html", "styles.css", "script.js", ".nojekyll", "README.md", "SCREENSHOT_CHECKLIST.md", "RELEASE_FORMAT.md",
    "firmware/README.md", "firmware/THIRD_PARTY_NOTICES.md"]) await writeFile(path.join(root, file), "Public content");
  await writeFile(path.join(root, "private-token.txt"), "Do not deploy");
  await writeFile(path.join(root, "manual/index.html"), '<a href="./assets/screen.svg">Manual</a>');
  await writeFile(path.join(root, "manual/assets/screen.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  for (const file of ["dictionary/index.html", "dictionary/worker.js", "dictionary/python/importer.py", "dictionary/vendor/runtime.wasm"]) await writeFile(path.join(root, file), "Public converter");
  const { release, images } = await syntheticRelease();
  release.manifest.version = "1.0.0";
  const filenames = { bootloader: "bootloader.bin", partitions: "partition-table.bin", application: "whiteos.bin" };
  const bytes = new Map();
  for (const part of release.manifest.parts) {
    part.file = filenames[part.role];
    bytes.set(part.file, images.get(part.role));
  }
  bytes.set("manifest.json", new TextEncoder().encode(JSON.stringify(release.manifest)));
  bytes.set("whiteos-1.0.0.zip", new Uint8Array([80, 75, 3, 4]));
  const repo = "synthetic/test-firmware";
  const record = { tag_name: "v1.0.0", html_url: `https://github.com/${repo}/releases/tag/v1.0.0`,
    published_at: "2026-10-10T00:00:00Z", draft: false, prerelease: false,
    assets: [...bytes].map(([name, content]) => ({ name, state: "uploaded", size: content.length,
      browser_download_url: `https://github.com/${repo}/releases/download/v1.0.0/${name}` })) };
  return { repo, releases: [record], root, output: path.join(temporary, "site"), bytes, manifest: release.manifest,
    download: async (url, limit) => {
      const content = bytes.get(url.slice(url.lastIndexOf("/") + 1));
      assert.ok(content.length <= limit);
      return content;
    } };
}

test("build mirrors only verified Release images and explicitly public files", async context => {
  const options = await fixture(context);
  const entries = await prepareReleaseSite(options);
  assert.equal(entries[0].tag, "v1.0.0");
  const index = JSON.parse(await readFile(path.join(options.output, "firmware/releases.json")));
  assert.equal(index.latest.releaseUrl, `https://github.com/${options.repo}/releases/tag/v1.0.0`);
  for (const part of options.manifest.parts) assert.deepEqual(
    new Uint8Array(await readFile(path.join(options.output, "firmware/releases/v1.0.0", part.file))), options.bytes.get(part.file));
  await assert.rejects(access(path.join(options.output, "private-token.txt")));
  await assert.rejects(access(path.join(options.output, "firmware/whiteos.bin")));
  for (const file of ["manual/index.html", "manual/assets/screen.svg", "dictionary/index.html", "dictionary/worker.js", "dictionary/python/importer.py", "dictionary/vendor/runtime.wasm"]) {
    assert.deepEqual(await readFile(path.join(options.output, file)), await readFile(path.join(options.root, file)));
  }
});

for (const failure of ["missing", "duplicate", "hash", "version", "url", "archive", "draft"]) {
  test(`build rejects ${failure} Release assets`, async context => {
    const options = await fixture(context);
    const record = options.releases[0];
    if (failure === "missing") record.assets = record.assets.filter(asset => asset.name !== "whiteos.bin");
    if (failure === "duplicate") record.assets.push(record.assets.find(asset => asset.name === "whiteos.bin"));
    if (failure === "hash") options.bytes.get("whiteos.bin")[24] ^= 1;
    if (failure === "version") {
      options.manifest.version = "1.0.1";
      options.bytes.set("manifest.json", new TextEncoder().encode(JSON.stringify(options.manifest)));
    }
    if (failure === "url") record.assets[0].browser_download_url = "https://evil.invalid/firmware.bin";
    if (failure === "archive") record.assets = record.assets.filter(asset => !asset.name.endsWith(".zip"));
    if (failure === "draft") record.draft = true;
    await assert.rejects(prepareReleaseSite(options));
    await assert.rejects(access(path.join(options.output, "firmware/releases.json")));
  });
}

test("Release discovery ignores drafts and prereleases and sorts numeric stable versions", async context => {
  context.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(url.startsWith("https://api.github.com/repos/synthetic/test-firmware/releases?"));
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    return new Response(JSON.stringify([
      { tag_name: "v1.9.0" }, { tag_name: "v1.10.0" }, { tag_name: "v2.0.0", prerelease: true },
      { tag_name: "v3.0.0", draft: true }, { tag_name: "v01.0.0" }, { tag_name: "other" },
    ]));
  });
  assert.deepEqual((await listStableReleases("synthetic/test-firmware", "test-only-token")).map(release => release.tag_name), ["v1.10.0", "v1.9.0"]);
});
