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
