import { cp, readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareFirmware } from "./prepare-firmware.mjs";
import { sha256, requireSafe } from "../flash/core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

export async function prepareRelease(build, version, output, notesFile) {
  requireSafe(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), "VERSION", "Use a stable X.Y.Z version.");
  const notes = await readFile(notesFile, "utf8");
  requireSafe(notes.trim().length > 0, "NOTES", "Release notes must not be empty.");
  // 只收录固定的公开说明与许可证，不打包源码目录或本机日志。/ Package only explicit public notes/licenses, never source trees or local logs.
  const licenses = path.join(root, "firmware/licenses");
  for (const item of await readdir(licenses, { recursive: true })) {
    requireSafe(!(await lstat(path.join(licenses, item))).isSymbolicLink(), "LICENSE", "License symlinks are not allowed.");
  }
  const manifest = await prepareFirmware(build, version, output);
  const fullName = `whiteos-${version}-full.bin`;
  await cp(licenses, path.join(output, "licenses"), { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(root, "firmware/THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md"));
  await writeFile(path.join(output, "RELEASE_NOTES.md"), notes, { flag: "wx" });
  await writeFile(path.join(output, "README.md"), `# whiteos ${version}\n\n适用于小纸 Pico（ESP32-S3，16 MB Flash）。\n\n打开 https://446599.github.io/whiteos/flash/ ，默认使用在线固件。页面识别版本后，已有 whiteos 直接选“固件更新”，首次安装选“全新烧录”，网页会自动下载并校验。\n\n只有在线下载失败时，才需要展开备用导入入口，选择完整包 ${fullName}。更新仅写应用；全新烧录写启动程序、分区表和应用。\n\n不整片擦除，不操作 TF 卡或 PMU 标定。完成后重新插拔 USB。\n\nZIP 为资料包，请先解压，再导入其中的 full.bin。不要将完整包整体写到地址 0；网页会提取所需镜像并保留空隙中的设备数据。\n\n各组件许可与来源见 THIRD_PARTY_NOTICES.md 和 licenses/；更新说明见 RELEASE_NOTES.md。\n`, { flag: "wx" });
  const members = ["bootloader.bin", "partition-table.bin", "whiteos.bin", "manifest.json", fullName,
    "README.md", "RELEASE_NOTES.md", "THIRD_PARTY_NOTICES.md", "licenses"];
  const zipName = `whiteos-${version}.zip`;
  // Python 标准库负责压缩，参数独立传入，避免 shell 解释文件名。/ Use the Python standard library with separate arguments, without shell filename interpretation.
  await execute(process.env.PYTHON || "python3", ["-c", `import pathlib,sys,zipfile
folder=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(folder/sys.argv[2], 'x', compression=zipfile.ZIP_DEFLATED) as archive:
 for name in sys.argv[3:]:
  source=folder/name
  paths=sorted(source.rglob('*')) if source.is_dir() else [source]
  for item in paths:
   if item.is_file(): archive.write(item, item.relative_to(folder).as_posix())
`, path.resolve(output), zipName, ...members]);
  const assets = ["bootloader.bin", "partition-table.bin", "whiteos.bin", "manifest.json", fullName, zipName];
  const sums = await Promise.all(assets.map(async name => `${await sha256(await readFile(path.join(output, name)))}  ${name}`));
  await writeFile(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n", { flag: "wx" });
  return { manifest, assets: [...assets, "SHA256SUMS"] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [build, version, output, notes] = process.argv.slice(2);
  if (!build || !version || !output || !notes) {
    console.error("Usage: node prepare-release.mjs BUILD_DIR VERSION EMPTY_OUTPUT_DIR RELEASE_NOTES");
    process.exitCode = 1;
  } else {
    try {
      const result = await prepareRelease(build, version, output, notes);
      console.log(`Prepared ${version}: ${result.assets.join(", ")}`);
      console.log("Prepared locally only; nothing flashed, pushed or published.");
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
