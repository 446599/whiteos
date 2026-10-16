import SparkMD5 from "./vendor/spark-md5.mjs";

export const FLASH_SIZE = 0x1000000;
export const APP_ADDRESS = 0x10000;
export const APP_SIZE = 0x800000;
export const TABLE_ADDRESS = 0x8000;
const SECTOR_SIZE = 0x1000;
const ROLES = {
  bootloader: { offset: 0, max: TABLE_ADDRESS },
  partitions: { offset: TABLE_ADDRESS, max: SECTOR_SIZE },
  application: { offset: APP_ADDRESS, max: APP_SIZE },
};
const EXPECTED_PARTITIONS = [
  { name: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x5000 },
  { name: "phy_init", type: 1, subtype: 1, offset: 0xe000, size: 0x1000 },
  { name: "factory", type: 0, subtype: 0, offset: APP_ADDRESS, size: APP_SIZE },
  { name: "storage", type: 1, subtype: 0x81, offset: 0x810000, size: 0x500000 },
];

export class FlashError extends Error {
  constructor(code, message) { super(message); this.name = "FlashError"; this.code = code; }
}
export function requireSafe(condition, code, message) {
  if (!condition) throw new FlashError(code, message);
}
export function validateSource(source) {
  if (source?.type === "release") {
    requireSafe(/^[A-Za-z0-9-]{1,39}$/.test(source.owner) &&
      /^[A-Za-z0-9_.-]{1,100}$/.test(source.repo) &&
      source.indexPath === "../firmware/releases.json",
    "SOURCE", "Release 固件源配置无效。");
    return source;
  }
  requireSafe(source && /^[A-Za-z0-9-]{1,39}$/.test(source.owner) &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(source.repo) &&
    typeof source.ref === "string" && source.ref.length > 0 && source.ref.length <= 200 &&
    typeof source.manifestPath === "string" &&
    source.manifestPath.split("/").every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)) &&
    source.manifestPath.endsWith(".json"),
  "SOURCE", "尚未配置公开固件源。");
  return source;
}
export function validateManifest(manifest) {
  requireSafe(manifest?.schema === 1 && manifest.board === "read-pico-4.7" &&
    manifest.chip === "ESP32-S3" && manifest.flashSize === FLASH_SIZE &&
    manifest.partitionTableOffset === TABLE_ADDRESS,
  "MANIFEST", "固件清单不适用于小纸 Pico。");
  requireSafe(typeof manifest.version === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(manifest.version),
  "MANIFEST", "固件版本标识无效。");
  requireSafe(Array.isArray(manifest.parts) && manifest.parts.length === 3,
    "MANIFEST", "发布包必须包含启动程序、分区表和应用。");
  const names = new Set();
  for (const part of manifest.parts) {
    const spec = ROLES[part?.role];
    requireSafe(spec && !names.has(part.role) && part.offset === spec.offset &&
      Number.isSafeInteger(part.size) && part.size >= 24 && part.size <= spec.max &&
      /^[a-f0-9]{64}$/.test(part.sha256) &&
      typeof part.file === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.bin$/.test(part.file),
    "MANIFEST", "镜像地址、大小或校验信息无效。");
    names.add(part.role);
  }
  requireSafe(new Set(manifest.parts.map((part) => part.file)).size === 3,
    "MANIFEST", "镜像文件名不能重复。");
  return manifest;
}
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function md5(bytes) {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return SparkMD5.ArrayBuffer.hash(buffer);
}
export function isBlank(bytes) { return bytes.every((value) => value === 0xff); }
export function validatePartitions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let ended = false;
  for (let offset = 0; offset + 32 <= bytes.length; offset += 32) {
    const magic = view.getUint16(offset, true);
    if (magic === 0xffff || magic === 0xebeb) { ended = true; break; }
    requireSafe(magic === 0x50aa, "PARTITIONS", "无法识别设备分区表，已停止烧录。");
    const nameBytes = bytes.slice(offset + 12, offset + 28);
    const end = nameBytes.indexOf(0);
    entries.push({
      name: new TextDecoder().decode(end < 0 ? nameBytes : nameBytes.slice(0, end)),
      type: bytes[offset + 2], subtype: bytes[offset + 3],
      offset: view.getUint32(offset + 4, true), size: view.getUint32(offset + 8, true),
      flags: view.getUint32(offset + 28, true),
    });
  }
  requireSafe(ended && entries.length === EXPECTED_PARTITIONS.length &&
    EXPECTED_PARTITIONS.every((expected, index) =>
      Object.entries(expected).every(([key, value]) => entries[index][key] === value) &&
      entries[index].flags === 0),
  "PARTITIONS", "设备分区布局不兼容；需要单独确认迁移，网页不会改写。");
  return entries;
}
export function validateImage(bytes, role) {
  if (role === "partitions") return validatePartitions(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireSafe(bytes.length >= 24 && bytes[0] === 0xe9 && bytes[1] > 0 &&
    bytes[1] <= 16 && view.getUint16(12, true) === 9,
  "IMAGE", "镜像不是有效的 ESP32-S3 固件。");
  if (role === "bootloader") {
    requireSafe((bytes[3] >> 4) === 4, "IMAGE", "启动程序未配置为 16 MB Flash。");
  }
}
export function imageLength(bytes) {
  requireSafe(bytes.length >= 24 && bytes[0] === 0xe9 && bytes[1] > 0 && bytes[1] <= 16,
    "IMAGE", "完整包中的 ESP 镜像头无效。");
  let end = 24;
  for (let index = 0; index < bytes[1]; index++) {
    requireSafe(end + 8 <= bytes.length, "IMAGE", "完整包中的 ESP 镜像段不完整。");
    const size = new DataView(bytes.buffer, bytes.byteOffset + end + 4, 4).getUint32(0, true);
    end += 8 + size;
    requireSafe(end <= bytes.length, "IMAGE", "完整包中的 ESP 镜像段超出文件范围。");
  }
  end = Math.ceil((end + 1) / 16) * 16;
  if (bytes[23] & 1) end += 32;
  requireSafe(end <= bytes.length, "IMAGE", "完整包中的 ESP 镜像尾部不完整。");
  return end;
}
// 导入文件不依赖文件名：核对段校验、内嵌摘要及产品版本。/ Verify segments, embedded digest and product version independently of filenames.
export async function verifyEspImage(bytes, role) {
  validateImage(bytes, role);
  const length = imageLength(bytes);
  requireSafe(length === bytes.length && bytes[23] === 1, "IMAGE", "镜像大小或内嵌校验信息无效，请重新下载完整包。");
  let cursor = 24, checksum = 0xef;
  for (let index = 0; index < bytes[1]; index++) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + cursor + 4, 4).getUint32(0, true);
    for (let at = cursor + 8; at < cursor + 8 + size; at++) checksum ^= bytes[at];
    cursor += 8 + size;
  }
  const digestOffset = length - 32;
  requireSafe(bytes[digestOffset - 1] === checksum, "IMAGE", "固件段校验失败，请重新下载完整包。");
  const digest = Array.from(bytes.subarray(digestOffset), byte => byte.toString(16).padStart(2, "0")).join("");
  requireSafe(await sha256(bytes.subarray(0, digestOffset)) === digest, "HASH", "固件内嵌摘要不匹配，请重新下载完整包。");
  if (role !== "application") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireSafe(view.getUint32(28, true) >= 256 && view.getUint32(32, true) === 0xabcd5432,
    "IMAGE", "应用缺少有效版本信息。");
  const field = offset => {
    const data = bytes.subarray(offset, offset + 32), end = data.indexOf(0);
    requireSafe(end > 0, "IMAGE", "应用版本信息无效。");
    return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, end));
  };
  const version = field(48);
  requireSafe(field(80) === "Read_Pico" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,30}$/.test(version),
    "IMAGE", "所选固件不适用于小纸 Pico。");
  return version;
}
export async function splitMergedBundle(bytes) {
  requireSafe(bytes instanceof Uint8Array && bytes.length > APP_ADDRESS && bytes.length <= APP_ADDRESS + APP_SIZE,
    "BUNDLE", "完整包大小不符合小纸 Pico 发布布局。");
  const bootSize = imageLength(bytes);
  requireSafe(bootSize <= TABLE_ADDRESS, "BUNDLE", "启动程序超出允许范围。");
  const bootloader = bytes.slice(0, bootSize);
  const table = bytes.slice(TABLE_ADDRESS, TABLE_ADDRESS + 3072);
  const appSize = imageLength(bytes.subarray(APP_ADDRESS));
  const application = bytes.slice(APP_ADDRESS, APP_ADDRESS + appSize);
  requireSafe(APP_ADDRESS + appSize === bytes.length &&
    isBlank(bytes.subarray(bootSize, TABLE_ADDRESS)) &&
    isBlank(bytes.subarray(TABLE_ADDRESS + 3072, APP_ADDRESS)),
    "BUNDLE", "完整包包含意外数据或大小不完整，请下载标有 full.bin 的官方附件。");
  await verifyEspImage(bootloader, "bootloader");
  validatePartitions(table);
  if (new DataView(table.buffer, table.byteOffset).getUint16(128, true) === 0xebeb) {
    const expected = Array.from(table.subarray(144, 160), byte => byte.toString(16).padStart(2, "0")).join("");
    requireSafe(isBlank(table.subarray(130, 144)) && isBlank(table.subarray(160)) &&
      md5(table.subarray(0, 128)) === expected, "PARTITIONS", "分区表摘要无效，请重新下载完整包。");
  } else {
    requireSafe(isBlank(table.subarray(128)), "PARTITIONS", "分区表尾部包含意外数据，请重新下载完整包。");
  }
  const version = await verifyEspImage(application, "application");
  const parts = [];
  for (const [role, offset, file, image] of [
    ["bootloader", 0, "bootloader.bin", bootloader],
    ["partitions", TABLE_ADDRESS, "partition-table.bin", table],
    ["application", APP_ADDRESS, "whiteos.bin", application],
  ]) parts.push({ role, offset, file, size: image.length, sha256: await sha256(image) });
  const manifest = validateManifest({ schema: 1, board: "read-pico-4.7", chip: "ESP32-S3",
    flashSize: FLASH_SIZE, partitionTableOffset: TABLE_ADDRESS, version, parts });
  return { manifest, images: new Map([["bootloader", bootloader], ["partitions", table], ["application", application]]) };
}
export function selectedParts(manifest, mode) {
  requireSafe(mode === "install" || mode === "update", "MODE", "未知烧录操作。");
  return manifest.parts.filter((part) => mode === "install" || part.role === "application")
    .sort((a, b) => a.offset - b.offset);
}
export function protectedRanges(parts) {
  const ranges = [];
  let start = 0;
  for (const part of [...parts].sort((a, b) => a.offset - b.offset)) {
    if (part.offset > start) ranges.push({ offset: start, size: part.offset - start });
    start = part.offset + Math.ceil(part.size / SECTOR_SIZE) * SECTOR_SIZE;
  }
  if (start < FLASH_SIZE) ranges.push({ offset: start, size: FLASH_SIZE - start });
  return ranges;
}
export function requireDevice(chip, flashSize, security, stub) {
  requireSafe(chip === "ESP32-S3", "CHIP", "请选择小纸 Pico 的 ESP32-S3 串口。");
  requireSafe(flashSize === "16MB", "SIZE", "设备 Flash 容量与发布包不符。");
  // Refuse signed/encrypted devices rather than guessing their provisioning state.
  const count = security?.flashCryptCnt;
  requireSafe(stub && security?.chipId === 9 && Number.isInteger(security.flags) &&
    (security.flags & 0x7) === 0 && Number.isInteger(count) && count >= 0 && count <= 255 &&
    [...count.toString(2)].filter((bit) => bit === "1").length % 2 === 0,
  "SECURITY", "设备安全状态不适用于普通网页烧录，已停止。");
}
