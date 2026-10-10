import { FlashError, requireSafe, validateSource, validateManifest, sha256, validateImage } from "./core.mjs?v=20261010-release";

async function download(url, limit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(url, {
      signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer",
    });
    requireSafe(response.ok, "DOWNLOAD", "固件源无法访问，请确认仓库公开且发布文件存在。");
    requireSafe(response.body, "DOWNLOAD", "浏览器无法读取固件文件。");
    const declared = response.headers.get("content-length");
    requireSafe(!declared || Number(declared) <= limit, "DOWNLOAD", "固件文件超过允许大小。");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        requireSafe(length <= limit, "DOWNLOAD", "固件文件超过允许大小。");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    if (error instanceof FlashError) throw error;
    throw new FlashError("DOWNLOAD", "固件下载失败，请检查网络及 GitHub 访问。");
  } finally { clearTimeout(timeout); }
}
async function json(url, limit) {
  try { return JSON.parse(new TextDecoder().decode(await download(url, limit))); }
  catch (error) {
    if (error instanceof FlashError) throw error;
    throw new FlashError("MANIFEST", "发布清单格式无效。");
  }
}
export async function loadRelease(config) {
  const source = validateSource(config);
  if (source.type === "release") {
    const indexUrl = new URL(source.indexPath, import.meta.url);
    const index = await json(indexUrl.href, 1024 * 1024);
    const current = index?.latest;
    requireSafe(index?.schema === 1 && current && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current.tag) &&
      current.version === current.tag.slice(1) && current.manifestPath === `releases/${current.tag}/manifest.json` &&
      current.releaseUrl === `https://github.com/${source.owner}/${source.repo}/releases/tag/${current.tag}`,
    "SOURCE", "Release 发布索引无效。");
    const manifestUrl = new URL(current.manifestPath, indexUrl);
    const manifest = validateManifest(await json(manifestUrl.href, 32768));
    requireSafe(manifest.version === current.version, "MANIFEST", "Release 与固件清单版本不一致。");
    return { manifest, assetBase: new URL("./", manifestUrl).href, tag: current.tag,
      releaseUrl: current.releaseUrl, source };
  }
  let commit = source.ref;
  if (!/^[a-f0-9]{40}$/i.test(commit)) {
    const record = await json(`https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`, 65536);
    commit = record.sha;
  }
  requireSafe(typeof commit === "string" && /^[a-f0-9]{40}$/i.test(commit),
    "SOURCE", "无法确认固件发布提交。");
  const base = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/`;
  const manifest = validateManifest(await json(base + source.manifestPath, 32768));
  const folder = source.manifestPath.slice(0, source.manifestPath.lastIndexOf("/") + 1);
  return { manifest, assetBase: base + folder, commit, source };
}
export async function downloadParts(release, onProgress) {
  const images = new Map();
  // Verify the whole release before touching the device, including the table on updates.
  for (let index = 0; index < release.manifest.parts.length; index++) {
    const part = release.manifest.parts[index];
    const bytes = await download(release.assetBase + part.file, part.size);
    requireSafe(bytes.length === part.size && await sha256(bytes) === part.sha256,
      "HASH", "固件完整性校验失败；没有写入设备。");
    validateImage(bytes, part.role);
    images.set(part.role, bytes);
    onProgress?.((index + 1) / release.manifest.parts.length);
  }
  return images;
}
