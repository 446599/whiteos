import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateManifest, validateSource, validatePartitions, validateImage, splitMergedBundle, requireDevice,
  protectedRanges, selectedParts, FLASH_SIZE, md5,
} from "../flash/core.mjs";
import { flashDevice } from "../flash/device.mjs";
import { loadRelease, downloadParts } from "../flash/github.mjs";
import { prepareFirmware } from "../tools/prepare-firmware.mjs";
import { syntheticTable, syntheticImage, syntheticRelease, completeImage, mergeImages } from "./flash-fixtures.mjs";

function fakeDevice(options = {}) {
  const memory = new Uint8Array(FLASH_SIZE).fill(0xff);
  if (!options.blank) memory.set(options.table ?? syntheticTable(), 0x8000);
  memory.fill(0x55, 0x9000, 0x10000);
  memory.fill(0x66, 0x810000, 0x810020);
  if (options.dirtyBoot) memory[0] = 0x12;
  const operations = [];
  let finishDigest;
  const port = { readable: null };
  class Transport {
    async disconnect() {
      operations.push("disconnect");
      if (options.closeFailure) throw new Error("Fake close failure");
      port.readable = null;
    }
  }
  class ESPLoader {
    constructor() { this.chip = { CHIP_NAME: options.chip ?? "ESP32-S3" }; this.IS_STUB = true; }
    async main() { port.readable = {}; operations.push("connect"); }
    async detectFlashSize() { return options.size ?? "16MB"; }
    async getSecurityInfo() { return options.security ?? { chipId: 9, flags: 0, flashCryptCnt: 0 }; }
    async readFlash(address, size) {
      operations.push(["read", address, size]);
      throw new Error("Streamed Flash reads must not be used");
    }
    async flashMd5sum(address, size) {
      operations.push(["digest", address, size]);
      if (options.stallDigest) return new Promise(resolve => { finishDigest = resolve; });
      if (options.badDigest) return "invalid";
      if (options.badReadback && operations.some(operation => operation[0] === "write") && address === 0x10000) {
        return "0".repeat(32);
      }
      return createHash("md5").update(memory.subarray(address, address + size)).digest("hex");
    }
    async writeFlash(settings) {
      assert.equal(settings.eraseAll, false);
      assert.equal(settings.flashSize, "keep");
      assert.equal(settings.flashMode, "keep");
      assert.equal(settings.flashFreq, "keep");
      assert.equal(settings.compress, true);
      for (const [index, file] of settings.fileArray.entries()) {
        operations.push(["write", file.address, file.data.length]);
        if (options.disconnectDuringWrite) throw new Error("Fake unplug");
        const sectorSize = Math.ceil(file.data.length / 4096) * 4096;
        memory.fill(0xff, file.address, file.address + sectorSize);
        memory.set(file.data, file.address);
        settings.reportProgress(index, 1, 2);
        settings.reportProgress(index, 2, 2);
      }
      if (options.damageProtected) memory[0x9000] ^= 1;
      if (options.damageTail) memory[FLASH_SIZE - 1] ^= 1;
    }
    async after() { if (options.resetFailure) throw new Error("Fake reset failure"); operations.push("reset"); }
  }
  return { memory, port, operations, finishDigest: () => finishDigest?.("0".repeat(32)), driver: { Transport, ESPLoader } };
}
async function runFake(options = {}, mode = "update", confirmation = true) {
  const fixture = await syntheticRelease();
  const device = fakeDevice(options);
  const progress = [];
  const execution = flashDevice({
    ...fixture, port: device.port, mode, onState: (...state) => progress.push(state),
    confirmInstall: () => confirmation, loadDriver: async () => device.driver,
  });
  return { device, progress, execution, fixture };
}

test("MD5 matches independent Node digests including partial typed-array views", () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 3, 4]);
  for (const view of [new Uint8Array(), new TextEncoder().encode("abc"), bytes, bytes.subarray(1, 4)]) {
    assert.equal(md5(view), createHash("md5").update(view).digest("hex"));
  }
});

test("protected-region digest timeout releases the port without writes, including a late response", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { execution, device, progress } = await runFake({ stallDigest: true });
  const rejection = assert.rejects(execution, error =>
    error.code === "TIMEOUT" && error.needsReconnect && /尚未写入/.test(error.message));
  for (let index = 0; index < 20; index++) await Promise.resolve();
  assert.ok(progress.some(([title, , percent]) => title === "检查保护区域" && percent === 30));
  context.mock.timers.tick(15000);
  await rejection;
  device.finishDigest();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  assert.equal(device.operations.some(operation => operation[0] === "write"), false);
  assert.equal(device.port.readable, null);
});

test("manifest accepts only the three bounded Pico images", async () => {
  const { release } = await syntheticRelease();
  assert.equal(validateManifest(release.manifest), release.manifest);
  for (const change of [
    { board: "other" }, { chip: "ESP32" }, { flashSize: 0x800000 }, { version: "<script>" },
    { partitionTableOffset: 0x7000 }, { parts: [] },
  ]) assert.throws(() => validateManifest({ ...release.manifest, ...change }));
  for (const change of [
    { offset: 0 }, { size: 0 }, { size: 0x800001 }, { sha256: "invalid" },
    { file: "../image.bin" }, { file: "https://example.com/image.bin" },
    { role: "nvs" },
  ]) {
    const manifest = structuredClone(release.manifest);
    Object.assign(manifest.parts[2], change);
    assert.throws(() => validateManifest(manifest));
  }
});

test("source rejects missing sources and path traversal", () => {
  const good = { owner: "test-owner", repo: "test-repo", ref: "main", manifestPath: "firmware/manifest.json" };
  assert.equal(validateSource(good), good);
  for (const source of [null, { ...good, owner: "../test" }, { ...good, manifestPath: "../manifest.json" },
    { ...good, manifestPath: "https://example.com/manifest.json" }, { ...good, ref: "" }]) {
    assert.throws(() => validateSource(source));
  }
});

test("published partition validation rejects old layout, extra partitions, wrong flags and malformed tables", () => {
  assert.equal(validatePartitions(syntheticTable()).length, 4);
  for (const offset of [0, 4, 8, 28, 64 + 8]) {
    const table = syntheticTable(); table[offset] ^= 1;
    assert.throws(() => validatePartitions(table));
  }
  assert.throws(() => validatePartitions(new Uint8Array(4096).fill(0xff)));
  assert.throws(() => validatePartitions(new Uint8Array(0)));
});

test("image headers reject another chip and wrong bootloader flash size", () => {
  validateImage(syntheticImage(), "application");
  const bytes = syntheticImage();
  bytes[12] = 0;
  assert.throws(() => validateImage(bytes, "application"));
  bytes[12] = 9; bytes[3] = 0;
  assert.throws(() => validateImage(bytes, "bootloader"));
});

test("device security rejects wrong chips, capacities, signing, encryption and missing state", () => {
  const security = { chipId: 9, flags: 0, flashCryptCnt: 0 };
  requireDevice("ESP32-S3", "16MB", security, true);
  requireDevice("ESP32-S3", "16MB", { ...security, flashCryptCnt: 3 }, true);
  for (const args of [
    ["ESP32", "16MB", security, true], ["ESP32-S3", "8MB", security, true],
    ["ESP32-S3", "16MB", { ...security, flags: 1 }, true],
    ["ESP32-S3", "16MB", { ...security, flags: 4 }, true],
    ["ESP32-S3", "16MB", { ...security, flashCryptCnt: 1 }, true],
    ["ESP32-S3", "16MB", null, true], ["ESP32-S3", "16MB", security, false],
  ]) assert.throws(() => requireDevice(...args));
});

test("protected ranges are the exact complement of sector-aligned writes", async () => {
  const { release } = await syntheticRelease();
  const writes = selectedParts(release.manifest, "update");
  assert.deepEqual(writes.map((part) => part.offset), [0x10000]);
  assert.deepEqual(protectedRanges(writes), [
    { offset: 0, size: 0x10000 }, { offset: 0x13000, size: FLASH_SIZE - 0x13000 },
  ]);
});

test("update writes only application and verifies every protected region", async () => {
  const { execution, device, progress } = await runFake();
  assert.deepEqual(await execution, { resetFailed: false, closeFailed: false });
  assert.deepEqual(device.operations.filter((operation) => operation[0] === "write").map((operation) => operation[1]), [0x10000]);
  assert.equal(device.memory[0x9000], 0x55);
  assert.equal(device.memory[0x810000], 0x66);
  assert.equal(device.port.readable, null);
  assert.ok(progress.some(([title]) => title === "校验固件"));
  assert.ok(device.operations.some((operation) => operation === "reset"));
  const reads = device.operations.filter((operation) => operation[0] === "read");
  assert.equal(reads.length, 0);
  const digests = device.operations.filter(operation => operation[0] === "digest");
  assert.ok(digests.every(operation => operation[2] <= 512 * 1024));
  assert.deepEqual(digests[0], ["digest", 0, 0x10000]);
  assert.equal(progress.some(([title]) => title === "检查分区"), false);
  assert.ok(progress.some(([title, , percent]) => title === "检查保护区域" && percent > 30));
});

test("fresh installation writes exactly bootloader, table and application, without data erase", async () => {
  for (const blank of [false, true]) {
    const { execution, device } = await runFake({ blank }, "install");
    await execution;
    assert.deepEqual(device.operations.filter((operation) => operation[0] === "write").map((operation) => operation[1]), [0, 0x8000, 0x10000]);
    assert.equal(device.memory[0x9000], 0x55);
    assert.equal(device.memory[0x810000], 0x66);
  }
});

test("both modes bypass existing partition-table compatibility checks and preserve their write ranges", async () => {
  for (const mode of ["install", "update"]) {
    for (const options of [{ blank: true }, { blank: true, dirtyBoot: true }, { table: new Uint8Array(4096).fill(0) }]) {
      const { execution, device, progress, fixture } = await runFake(options, mode);
      const originalTable = device.memory.slice(0x8000, 0x9000);
      await execution;
      const writeIndex = device.operations.findIndex(operation => operation[0] === "write");
      assert.ok(writeIndex >= 0);
      assert.equal(progress.some(([title]) => title === "检查分区"), false);
      assert.equal(device.operations.slice(0, writeIndex).some(operation =>
        operation[0] === "digest" && operation[1] === 0x8000 && operation[2] === 4096), false);
      assert.deepEqual(device.operations.filter(operation => operation[0] === "write").map(operation => operation[1]),
        mode === "install" ? [0, 0x8000, 0x10000] : [0x10000]);
      if (mode === "update") assert.deepEqual(device.memory.slice(0x8000, 0x9000), originalTable);
      else assert.deepEqual(device.memory.slice(0x8000, 0x8000 + fixture.images.get("partitions").length), fixture.images.get("partitions"));
      assert.equal(device.memory[0x9000], 0x55);
      assert.equal(device.memory[0x810000], 0x66);
    }
  }
});

test("image digest verification covers block boundaries and the unaligned final byte", async () => {
  const fixture = await syntheticRelease();
  const image = syntheticImage(512 * 1024 + 37);
  image[image.length - 1] = 0x73;
  fixture.images.set("application", image);
  const part = fixture.release.manifest.parts.find(part => part.role === "application");
  part.size = image.length;
  const device = fakeDevice();
  await flashDevice({
    ...fixture, port: device.port, mode: "update", onState() {},
    confirmInstall: () => true, loadDriver: async () => device.driver,
  });
  const writeIndex = device.operations.findIndex(operation => operation[0] === "write");
  const digests = device.operations.slice(writeIndex + 1).filter(operation => operation[0] === "digest");
  assert.deepEqual(digests.slice(0, 2), [
    ["digest", 0x10000, 512 * 1024], ["digest", 0x10000 + 512 * 1024, 37],
  ]);
  assert.equal(device.memory[part.offset + part.size - 1], 0x73);
});

for (const [name, options, mode, confirmation, code] of [
  ["wrong chip", { chip: "ESP32-C3" }, "update", true, "CHIP"],
  ["wrong capacity", { size: "8MB" }, "update", true, "SIZE"],
  ["cancelled confirmation", {}, "install", false, "CANCELLED"],
  ["invalid protected-region digest", { badDigest: true }, "update", true, "VERIFY"],
]) {
  test(`${name}: rejects before writing and releases the port`, async () => {
    const { execution, device } = await runFake(options, mode, confirmation);
    await assert.rejects(execution, (error) => error.code === code);
    assert.equal(device.operations.some((operation) => operation[0] === "write"), false);
    assert.equal(device.port.readable, null);
  });
}
for (const [name, options, code] of [
  ["bad application readback", { badReadback: true }, "VERIFY"],
  ["changed protected data", { damageProtected: true }, "PROTECTED"],
  ["changed final protected byte", { damageTail: true }, "PROTECTED"],
  ["USB disconnection", { disconnectDuringWrite: true }, "SERIAL"],
]) {
  test(`${name}: never reports success or resets`, async () => {
    const { execution, device } = await runFake(options);
    await assert.rejects(execution, (error) => error.code === code);
    assert.equal(device.operations.includes("reset"), false);
    assert.equal(device.port.readable, null);
  });
}
test("reset and close errors are not disguised as firmware verification failures", async () => {
  const reset = await runFake({ resetFailure: true });
  assert.equal((await reset.execution).resetFailed, true);
  const close = await runFake({ closeFailure: true });
  assert.equal((await close.execution).closeFailed, true);
});

test("GitHub resolves a branch once and all artifacts use the same immutable commit", async (context) => {
  const { release, images } = await syntheticRelease();
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) return new Response(JSON.stringify({ sha: release.commit }));
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify(release.manifest));
    const part = release.manifest.parts.find((part) => url.endsWith(part.file));
    return new Response(images.get(part.role));
  });
  const loaded = await loadRelease(release.source);
  const downloaded = await downloadParts(loaded);
  assert.equal(downloaded.size, 3);
  assert.equal(calls.filter((url) => url.startsWith("https://api.github.com/")).length, 1);
  assert.ok(calls.slice(1).every((url) => url.includes(release.commit)));
});
test("GitHub never accepts altered, oversized or missing downloads", async (context) => {
  const { release } = await syntheticRelease();
  for (const response of [
    () => new Response("bad"),
    () => new Response(null, { status: 404 }),
    () => new Response(new Uint8Array(10000)),
  ]) {
    context.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(downloadParts(release));
    context.mock.restoreAll();
  }
});
test("pinned source skips API and a moved API response cannot change artifact paths", async (context) => {
  const { release } = await syntheticRelease();
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url); return new Response(JSON.stringify(release.manifest));
  });
  await loadRelease({ ...release.source, ref: release.commit });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("https://raw.githubusercontent.com/"));
});

test("Release mirror locks the tag and reads all artifacts from one version directory without API calls", async (context) => {
  const fixture = await syntheticRelease();
  fixture.release.manifest.version = "1.0.0";
  const source = { type: "release", owner: "synthetic", repo: "test-firmware", indexPath: "../firmware/releases.json" };
  const entry = { tag: "v1.0.0", version: "1.0.0", manifestPath: "releases/v1.0.0/manifest.json",
    releaseUrl: "https://github.com/synthetic/test-firmware/releases/tag/v1.0.0" };
  const calls = [];
  context.mock.method(globalThis, "fetch", async url => {
    calls.push(url);
    if (url.endsWith("releases.json")) return new Response(JSON.stringify({ schema: 1, latest: entry }));
    assert.ok(url.includes("/firmware/releases/v1.0.0/"));
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify(fixture.release.manifest));
    const part = fixture.release.manifest.parts.find(part => url.endsWith(part.file));
    return new Response(fixture.images.get(part.role));
  });
  const loaded = await loadRelease(source);
  assert.equal(loaded.tag, "v1.0.0");
  entry.tag = "v1.0.1";
  assert.equal((await downloadParts(loaded)).size, 3);
  assert.equal(calls.length, 5);
  assert.equal(calls.some(url => url.startsWith("https://api.github.com") || url.startsWith("https://github.com")), false);
});

test("Release mirror rejects malformed indices, version mismatches and external asset paths", async (context) => {
  const fixture = await syntheticRelease();
  const source = { type: "release", owner: "synthetic", repo: "test-firmware", indexPath: "../firmware/releases.json" };
  const entry = { tag: "v1.0.0", version: "1.0.0", manifestPath: "releases/v1.0.0/manifest.json",
    releaseUrl: "https://github.com/synthetic/test-firmware/releases/tag/v1.0.0" };
  for (const invalid of [null, { tag: "../v1.0.0" }, { version: "1.0.1" }, { manifestPath: "https://evil.invalid/manifest.json" },
    { releaseUrl: "https://github.com/another/repo/releases/tag/v1.0.0" }]) {
    context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ schema: 1, latest: invalid === null ? null : { ...entry, ...invalid } })));
    await assert.rejects(loadRelease(source), error => error.code === "SOURCE");
    context.mock.restoreAll();
  }
  context.mock.method(globalThis, "fetch", async url => new Response(JSON.stringify(
    url.endsWith("releases.json") ? { schema: 1, latest: entry } : fixture.release.manifest)));
  await assert.rejects(loadRelease(source), error => error.code === "MANIFEST");
  assert.throws(() => validateSource({ ...source, indexPath: "https://evil.invalid/index.json" }));
});

test("publisher consumes actual flash mappings, preserves release files and rejects extra data images", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "whiteos-flash-test-"));
  try {
    const build = path.join(temporary, "build");
    const output = path.join(temporary, "release");
    await mkdir(build);
    const { images } = await syntheticRelease();
    for (const [role, bytes] of images) await writeFile(path.join(build, `${role}.bin`), bytes);
    const args = { extra_esptool_args: { chip: "esp32s3" }, flash_settings: { flash_size: "16MB" },
      flash_files: { "0x0": "bootloader.bin", "0x8000": "partitions.bin", "0x10000": "application.bin" } };
    await writeFile(path.join(build, "flasher_args.json"), JSON.stringify(args));
    await assert.rejects(prepareFirmware(build, "wrong-version", path.join(temporary, "wrong")), /version/);
    const manifest = await prepareFirmware(build, "test-only-1.0", output);
    assert.equal(manifest.parts.length, 3);
    assert.equal(JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8")).version, "test-only-1.0");
    const full = new Uint8Array(await readFile(path.join(output, "whiteos-test-only-1.0-full.bin")));
    const split = await splitMergedBundle(full);
    assert.deepEqual(split.images.get("bootloader"), images.get("bootloader"));
    assert.deepEqual(split.images.get("application"), images.get("application"));
    assert.deepEqual(split.images.get("partitions"), images.get("partitions"));
    await assert.rejects(prepareFirmware(build, "test-only-1.0", output), /empty/);
    args.flash_files["0x9000"] = "nvs.bin";
    await writeFile(path.join(build, "flasher_args.json"), JSON.stringify(args));
    await assert.rejects(prepareFirmware(build, "test-2.0", path.join(temporary, "invalid")), /no data images/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("merged import validates embedded version, both images and padding independently of filename", async () => {
  const { images } = await syntheticRelease();
  const full = mergeImages(images);
  const split = await splitMergedBundle(full);
  assert.equal(split.manifest.version, "test-only-1.0");
  for (const [role, bytes] of images) assert.deepEqual(split.images.get(role), bytes);
  for (const mutate of [
    bytes => bytes.subarray(0, bytes.length - 1),
    bytes => { bytes[100] ^= 1; return bytes; },
    bytes => { bytes[0x10000 + 100] ^= 1; return bytes; },
    bytes => { bytes[0x10000 + bytes.length - 0x10000 - 1] ^= 1; return bytes; },
    bytes => { bytes[0x9000] = 0; return bytes; },
    bytes => { bytes[0x7000] = 0; return bytes; },
    bytes => { bytes[0x8000 + 64 + 8] ^= 1; return bytes; },
    bytes => { bytes[12] = 0; return bytes; },
    bytes => { const extra = new Uint8Array(bytes.length + 1); extra.set(bytes); return extra; },
    () => new Uint8Array(0x810001),
  ]) await assert.rejects(splitMergedBundle(mutate(full.slice())));
  for (const [version, project] of [["1.0.0", "Other_Product"], ["<bad>", "Read_Pico"]]) {
    const wrong = new Map(images);
    wrong.set("application", completeImage(8224, version, project));
    await assert.rejects(splitMergedBundle(mergeImages(wrong)), /不适用于/);
  }
});

test("imported full bundle retains application-only updates and three-part installs", async () => {
  const { images } = await syntheticRelease();
  const imported = await splitMergedBundle(mergeImages(images));
  for (const mode of ["install", "update"]) {
    const device = fakeDevice();
    const originalBoot = device.memory.slice(0, 0x8000);
    await flashDevice({ release: { manifest: imported.manifest }, images: imported.images,
      port: device.port, mode, onState() {}, confirmInstall: () => true, loadDriver: async () => device.driver });
    assert.deepEqual(device.operations.filter(op => op[0] === "write").map(op => op[1]),
      mode === "install" ? [0, 0x8000, 0x10000] : [0x10000]);
    if (mode === "update") assert.deepEqual(device.memory.slice(0, 0x8000), originalBoot);
    assert.equal(device.memory[0x9000], 0x55);
    assert.equal(device.memory[0x810000], 0x66);
  }
});

test("full bundle validates partition MD5 and rejects data hidden in table padding", async () => {
  const { images } = await syntheticRelease();
  const table = images.get("partitions");
  const digest = md5(table.subarray(0, 128));
  new DataView(table.buffer).setUint16(128, 0xebeb, true);
  table.set(Uint8Array.from(digest.match(/../g), hex => parseInt(hex, 16)), 144);
  const full = mergeImages(images);
  await splitMergedBundle(full);
  for (const offset of [0x8000 + 144, 0x8000 + 200, 0x8000 + 135]) {
    const corrupt = full.slice(); corrupt[offset] ^= 1;
    await assert.rejects(splitMergedBundle(corrupt), /分区表/);
  }
});
