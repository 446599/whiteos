import { createHash } from "node:crypto";
import { sha256, FLASH_SIZE } from "../flash/core.mjs";

export function syntheticTable() {
  const bytes = new Uint8Array(3072).fill(0xff);
  const view = new DataView(bytes.buffer);
  const entries = [
    ["nvs", 1, 2, 0x9000, 0x5000],
    ["phy_init", 1, 1, 0xe000, 0x1000],
    ["factory", 0, 0, 0x10000, 0x800000],
    ["storage", 1, 0x81, 0x810000, 0x500000],
  ];
  entries.forEach(([name, type, subtype, address, size], index) => {
    const offset = index * 32;
    view.setUint16(offset, 0x50aa, true);
    bytes[offset + 2] = type;
    bytes[offset + 3] = subtype;
    view.setUint32(offset + 4, address, true);
    view.setUint32(offset + 8, size, true);
    bytes.fill(0, offset + 12, offset + 32);
    bytes.set(new TextEncoder().encode(name), offset + 12);
  });
  return bytes;
}
export function syntheticImage(length = 8211) {
  const bytes = new Uint8Array(length).fill(0x42);
  bytes[0] = 0xe9;
  bytes[1] = 1;
  bytes[3] = 0x40;
  bytes[12] = 9;
  bytes[13] = 0;
  new DataView(bytes.buffer).setUint32(28, length - 48, true);
  return bytes;
}
// 有效的合成 ESP 镜像，不含设备数据。/ Valid synthetic ESP image without device data.
export function completeImage(length = 8224, version = "test-only-1.0", project = "Read_Pico") {
  const size = Math.ceil(length / 16) * 16;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0xe9; bytes[1] = 1; bytes[3] = 0x40; bytes[12] = 9; bytes[23] = 1;
  view.setUint32(28, size - 80, true);
  bytes.fill(0x42, 32, size - 48);
  view.setUint32(32, 0xabcd5432, true);
  for (const [offset, value] of [[48, version], [80, project]]) {
    bytes.fill(0, offset, offset + 32);
    bytes.set(new TextEncoder().encode(value), offset);
  }
  let checksum = 0xef;
  for (const value of bytes.subarray(32, size - 48)) checksum ^= value;
  bytes[size - 33] = checksum;
  bytes.set(createHash("sha256").update(bytes.subarray(0, size - 32)).digest(), size - 32);
  return bytes;
}
export function mergeImages(images) {
  const bytes = new Uint8Array(0x10000 + images.get("application").length).fill(0xff);
  for (const [role, offset] of [["bootloader", 0], ["partitions", 0x8000], ["application", 0x10000]]) {
    bytes.set(images.get(role), offset);
  }
  return bytes;
}
export async function syntheticRelease() {
  const images = new Map([
    ["bootloader", completeImage(4112)], ["partitions", syntheticTable()],
    ["application", completeImage(8224)],
  ]);
  const offsets = { bootloader: 0, partitions: 0x8000, application: 0x10000 };
  const parts = await Promise.all([...images].map(async ([role, bytes]) => ({
    role, offset: offsets[role], size: bytes.length, sha256: await sha256(bytes), file: `${role}.bin`,
  })));
  return {
    images,
    release: {
      manifest: { schema: 1, board: "read-pico-4.7", chip: "ESP32-S3", flashSize: FLASH_SIZE,
        partitionTableOffset: 0x8000, version: "test-only-1.0", parts },
      source: { owner: "synthetic", repo: "test-firmware", ref: "main", manifestPath: "firmware/manifest.json" },
      commit: "a".repeat(40),
      assetBase: `https://raw.githubusercontent.com/synthetic/test-firmware/${"a".repeat(40)}/firmware/`,
    },
  };
}
