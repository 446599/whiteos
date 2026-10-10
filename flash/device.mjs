import {
  FlashError, requireSafe, requireDevice,
  selectedParts, protectedRanges, md5,
} from "./core.mjs?v=20261010-release";

const DIGEST_BLOCK_SIZE = 512 * 1024;
const DIGEST_TIMEOUT_MS = 15000;

async function deviceDigest(loader, offset, size) {
  let timer;
  try {
    const hash = await Promise.race([
      loader.flashMd5sum(offset, size),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new FlashError("TIMEOUT", "设备校验超时，请拔插 USB、刷新页面后重试。");
          error.needsReconnect = true;
          reject(error);
        }, DIGEST_TIMEOUT_MS);
      }),
    ]);
    requireSafe(typeof hash === "string" && /^[a-f0-9]{32}$/i.test(hash),
      "VERIFY", "设备返回的校验信息无效，已停止。");
    return hash.toLowerCase();
  } finally {
    clearTimeout(timer);
  }
}
async function regionDigests(loader, ranges, onProgress) {
  const hashes = [];
  const total = ranges.reduce((sum, range) => sum + range.size, 0);
  let completed = 0;
  for (const range of ranges) {
    for (let done = 0; done < range.size; done += DIGEST_BLOCK_SIZE) {
      const size = Math.min(DIGEST_BLOCK_SIZE, range.size - done);
      hashes.push(await deviceDigest(loader, range.offset + done, size));
      completed += size;
      onProgress?.(completed / total);
    }
  }
  return hashes;
}
export async function flashDevice({ port, release, images, mode, onState, confirmInstall, loadDriver }) {
  let transport;
  let wrote = false;
  let verified = false;
  let failure;
  const result = { resetFailed: false, closeFailed: false };
  try {
    const driver = await loadDriver();
    transport = new driver.Transport(port);
    // Never expose loader logs: they can include the device MAC address.
    const terminal = { clean() {}, write() {}, writeLine() {} };
    const loader = new driver.ESPLoader({ transport, baudrate: 115200, terminal, debugLogging: false });
    onState("识别设备", "正在确认芯片、容量与安全状态。", 20);
    await loader.main();
    requireDevice(loader.chip?.CHIP_NAME, await loader.detectFlashSize(),
      await loader.getSecurityInfo(), loader.IS_STUB);

    const parts = selectedParts(release.manifest, mode);
    const ranges = protectedRanges(parts);
    onState("检查保护区域", "只计算设备摘要，不读取或上传用户文件。", 30);
    const before = await regionDigests(loader, ranges, (fraction) =>
      onState("检查保护区域", "尚未写入。正在核对数据区域。", 30 + 4 * fraction));

    if (mode === "install" && !confirmInstall(
      `全新烧录 whiteos ${release.manifest.version}？\n\n将写入发布包中的启动程序、分区表和应用。\n不整片擦除，不操作 TF 卡或 PMU。\n烧录中断可能需要重新烧录；请保持 USB 连接。`,
    )) { throw new FlashError("CANCELLED", "已取消，没有写入设备。"); }

    const sizes = parts.map((part) => part.size);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    onState("正在烧录", "请保持 USB 连接，不要关闭页面。", 35);
    wrote = true;
    await loader.writeFlash({
      fileArray: parts.map((part) => ({ address: part.offset, data: images.get(part.role) })),
      flashSize: "keep", flashMode: "keep", flashFreq: "keep", eraseAll: false, compress: true,
      reportProgress(index, written, compressedSize) {
        const completed = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
        const fraction = compressedSize ? Math.min(1, written / compressedSize) : 0;
        onState("正在烧录", "请保持 USB 连接，不要关闭页面。",
          35 + 45 * (completed + sizes[index] * fraction) / total);
      },
    });
    onState("校验固件", "正在设备内核对写入内容。", 82);
    let verifiedBytes = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const bytes = images.get(part.role);
      for (let done = 0; done < part.size; done += DIGEST_BLOCK_SIZE) {
        const size = Math.min(DIGEST_BLOCK_SIZE, part.size - done);
        requireSafe(await deviceDigest(loader, part.offset + done, size) === md5(bytes.subarray(done, done + size)),
          "VERIFY", "写入内容校验失败，请重新烧录。");
        onState("校验固件", "正在设备内核对写入内容。", 82 + 10 * (verifiedBytes + done + size) / total);
      }
      verifiedBytes += part.size;
    }
    onState("检查数据保护", "确认烧录范围之外的 Flash 摘要没有变化。", 94);
    const after = await regionDigests(loader, ranges, (fraction) =>
      onState("检查数据保护", "确认烧录范围之外的 Flash 没有变化。", 94 + 5 * fraction));
    requireSafe(before.every((hash, index) => hash === after[index]),
      "PROTECTED", "保护区域摘要变化，请停止使用设备并检查恢复方案。");
    verified = true;
    try { await loader.after("hard_reset"); } catch { result.resetFailed = true; }
    return result;
  } catch (error) {
    if (error instanceof FlashError) {
      if (wrote && !verified) error.message += " 写入已开始，勿当作安装成功；需重新检查或烧录。";
      else if (!wrote) error.message += " 尚未写入设备。";
      failure = error;
    } else {
      failure = new FlashError("SERIAL", wrote
        ? "烧录或校验中断，设备可能无法启动。请保持供电并重新烧录；尚未确认成功。"
        : "无法连接设备。请关闭其他串口工具，并确认设备处于下载模式后重试。");
    }
    throw failure;
  } finally {
    if (transport && port.readable) {
      let timer;
      try {
        await Promise.race([
          transport.disconnect(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Close timeout")), 5000); }),
        ]);
      } catch {
        result.closeFailed = true;
        if (failure) {
          failure.needsReconnect = true;
          failure.message += " 串口未正常释放，请拔插 USB 并刷新页面。";
        }
      } finally { clearTimeout(timer); }
    }
  }
}
