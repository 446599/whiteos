import { readFile, writeFile, mkdir, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest, validateImage, sha256, requireSafe, verifyEspImage, splitMergedBundle } from "../flash/core.mjs";

export async function prepareFirmware(buildDirectory, version, outputDirectory) {
  const build = await realpath(buildDirectory);
  const args = JSON.parse(await readFile(path.join(build, "flasher_args.json"), "utf8"));
  requireSafe(args.extra_esptool_args?.chip === "esp32s3", "BUILD", "Build target must be esp32s3.");
  requireSafe(args.flash_settings?.flash_size === "16MB", "BUILD", "Build must use 16MB Flash.");
  const files = Object.entries(args.flash_files ?? {});
  const layouts = [
    { role: "bootloader", offset: 0, file: "bootloader.bin" },
    { role: "partitions", offset: 0x8000, file: "partition-table.bin" },
    { role: "application", offset: 0x10000, file: "whiteos.bin" },
  ];
  requireSafe(files.length === 3 && files.every(([address]) =>
    /^0x[0-9a-f]+$/i.test(address) && layouts.some((part) => part.offset === Number(address))),
  "BUILD", "Expected only bootloader, partition table and application; no data images.");
  const prepared = [];
  for (const layout of layouts) {
    const matches = files.filter(([address]) => Number(address) === layout.offset);
    requireSafe(matches.length === 1 && typeof matches[0][1] === "string", "BUILD", "Ambiguous flash mapping.");
    const input = await realpath(path.resolve(build, matches[0][1]));
    requireSafe(input.startsWith(build + path.sep), "BUILD", "Build artifact must reside inside the build directory.");
    const bytes = new Uint8Array(await readFile(input));
    validateImage(bytes, layout.role);
    if (layout.role !== "partitions") {
      const embedded = await verifyEspImage(bytes, layout.role);
      requireSafe(layout.role !== "application" || embedded === version, "VERSION", "Requested version does not match the built application.");
    }
    prepared.push({ ...layout, size: bytes.length, sha256: await sha256(bytes), bytes });
  }
  const manifest = validateManifest({
    schema: 1, board: "read-pico-4.7", chip: "ESP32-S3", flashSize: 0x1000000,
    partitionTableOffset: 0x8000, version,
    parts: prepared.map(({ bytes, ...part }) => part),
  });
  const output = path.resolve(outputDirectory);
  const merged = new Uint8Array(Math.max(...prepared.map(part => part.offset + part.size))).fill(0xff);
  for (const part of prepared) merged.set(part.bytes, part.offset);
  await splitMergedBundle(merged);
  const contents = await readdir(output).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  requireSafe(contents.length === 0, "OUTPUT", "Output directory must be empty; existing releases are not overwritten.");
  await mkdir(output, { recursive: true });
  for (const part of prepared) await writeFile(path.join(output, part.file), part.bytes, { flag: "wx" });
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(output, `whiteos-${version}-full.bin`), merged, { flag: "wx" });
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [build, version, output] = process.argv.slice(2);
  if (!build || !version || !output) {
    console.error("Usage: node prepare-firmware.mjs BUILD_DIR VERSION EMPTY_OUTPUT_DIR");
    process.exitCode = 1;
  } else {
    try {
      const manifest = await prepareFirmware(build, version, output);
      console.log(`Prepared ${manifest.version}: ${path.resolve(output)}`);
      console.log("No firmware was built, flashed, pushed or published.");
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
