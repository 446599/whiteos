import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareRelease } from "../tools/prepare-release.mjs";
import { completeImage, syntheticTable } from "./flash-fixtures.mjs";
import { sha256 } from "../flash/core.mjs";

test("release package includes full bundle, checksums and licenses without local files", async context => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "whiteos-package-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const build = path.join(temporary, "build"), output = path.join(temporary, "release");
  await mkdir(build);
  for (const [name, bytes] of [["boot.bin", completeImage(4112)], ["table.bin", syntheticTable()], ["app.bin", completeImage(8224, "1.1.3")]]) {
    await writeFile(path.join(build, name), bytes);
  }
  await writeFile(path.join(build, "private-token.txt"), "must never be packaged");
  await writeFile(path.join(build, "flasher_args.json"), JSON.stringify({ extra_esptool_args: { chip: "esp32s3" },
    flash_settings: { flash_size: "16MB" }, flash_files: { "0x0": "boot.bin", "0x8000": "table.bin", "0x10000": "app.bin" } }));
  const notes = path.join(temporary, "notes.md");
  await writeFile(notes, "# whiteos 1.1.3\n\n更新说明\n");
  const result = await prepareRelease(build, "1.1.3", output, notes);
  assert.equal(result.assets.length, 7);
  const sums = await readFile(path.join(output, "SHA256SUMS"), "utf8");
  for (const line of sums.trim().split("\n")) {
    const [hash, file] = line.split("  ");
    assert.equal(await sha256(await readFile(path.join(output, file))), hash);
  }
  const { stdout } = await promisify(execFile)(process.env.PYTHON || "python3", ["-c", `import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 print(json.dumps(z.namelist()))
`, path.join(output, "whiteos-1.1.3.zip")]);
  const members = JSON.parse(stdout);
  for (const name of ["whiteos-1.1.3-full.bin", "manifest.json", "RELEASE_NOTES.md", "THIRD_PARTY_NOTICES.md"]) assert.ok(members.includes(name));
  assert.ok(members.some(name => name.startsWith("licenses/")));
  assert.equal(members.some(name => name.includes("private-token") || name.endsWith(".elf") || name.endsWith(".log")), false);
  await assert.rejects(prepareRelease(build, "1.1.3", output, notes), /empty/);
});
