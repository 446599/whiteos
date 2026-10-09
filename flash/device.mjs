import {
  TABLE_ADDRESS, FlashError, requireSafe, requireDevice, isBlank,
  validatePartitions, selectedParts, protectedRanges, sha256,
} from "./core.mjs";

async function readExact(loader, offset, size, onProgress) {
  const bytes = new Uint8Array(size);
  // Bound reads to avoid the upstream reader's repeated large buffer copies.
  for (let done = 0; done < size; done += 65536) {
    const count = Math.min(65536, size - done);
    const chunk = await loader.readFlash(offset + done, count);
    requireSafe(chunk instanceof Uint8Array && chunk.length === count,
      "READ", "设备读回数据不完整，已停止。");
    bytes.set(chunk, done);
    onProgress?.(done + count);
  }
  return bytes;
}
async function regionDigests(loader, ranges) {
  const hashes = [];
  for (const range of ranges) {
    const hash = await loader.flashMd5sum(range.offset, range.size);
    requireSafe(typeof hash === "string" && /^[a-f0-9]{32}$/i.test(hash),
      "VERIFY", "设备保护区域校验失败。");
    hashes.push(hash.toLowerCase());
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

    onState("检查分区", "尚未写入。正在核对设备分区布局。", 25);
    const table = await readExact(loader, TABLE_ADDRESS, 4096);
    if (isBlank(table)) {
      requireSafe(mode === "install", "BLANK", "设备尚未安装固件，请使用全新烧录。");
      requireSafe(isBlank(await readExact(loader, 0, TABLE_ADDRESS)),
        "PARTITIONS", "分区表为空但启动区不是空白，需单独确认恢复方案。");
    } else { validatePartitions(table); }
    const parts = selectedParts(release.manifest, mode);
    const ranges = protectedRanges(parts);
    onState("检查保护区域", "只计算设备摘要，不读取或上传用户文件。", 30);
    const before = await regionDigests(loader, ranges);

    if (mode === "install" && !confirmInstall(
      `全新烧录 whiteos ${release.manifest.version}？\n\n将写入启动程序、已核对的分区表和应用。\n不整片擦除，不操作 TF 卡或 PMU。\n烧录中断可能需要重新烧录；请保持 USB 连接。`,
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
    onState("读回校验", "正在逐个核对镜像 SHA-256。", 82);
    let verifiedBytes = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const readback = await readExact(loader, part.offset, part.size, (bytes) =>
        onState("读回校验", "正在逐个核对镜像 SHA-256。", 82 + 10 * (verifiedBytes + bytes) / total));
      requireSafe(await sha256(readback) === part.sha256, "VERIFY", "镜像读回校验失败，请重新烧录。");
      verifiedBytes += part.size;
    }
    onState("检查数据保护", "确认烧录范围之外的 Flash 摘要没有变化。", 94);
    const after = await regionDigests(loader, ranges);
    requireSafe(before.every((hash, index) => hash === after[index]),
      "PROTECTED", "保护区域摘要变化，请停止使用设备并检查恢复方案。");
    verified = true;
    try { await loader.after("hard_reset"); } catch { result.resetFailed = true; }
    return result;
  } catch (error) {
    if (error instanceof FlashError) {
      if (wrote && !verified) error.message += " 写入已开始，勿当作安装成功；需重新检查或烧录。";
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
