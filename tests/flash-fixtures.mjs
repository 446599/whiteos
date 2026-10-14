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
  return bytes;
}
export async function syntheticRelease() {
  const images = new Map([
    ["bootloader", syntheticImage(4097)], ["partitions", syntheticTable()],
    ["application", syntheticImage()],
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
