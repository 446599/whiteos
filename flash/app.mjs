import { firmwareSource } from "./config.mjs?v=20261010-release";
import { FlashError, splitMergedBundle, APP_ADDRESS, APP_SIZE } from "./core.mjs?v=20261016-import";
import { loadRelease, downloadParts } from "./github.mjs?v=20261016-import";
import { flashDevice } from "./device.mjs?v=20261016-import";

const $ = (id) => document.getElementById(id);
const buttons = [$("install"), $("update")];
let release = null;
let importedImages = null;
let sourceMode = "online";
let sourceGeneration = 0;
let onlineLoading = false;
let busy = false;
let needsReconnect = false;
let lastEvent = "";
const supported = window.isSecureContext && typeof navigator.serial?.requestPort === "function";

function state(title, detail, progress = 0, kind = "working") {
  if ($("status-title").textContent !== title) $("status-title").textContent = title;
  if ($("status-detail").textContent !== detail) $("status-detail").textContent = detail;
  $("status-dot").dataset.state = kind;
  $("progress").value = Math.round(progress);
  $("percent").textContent = `${Math.round(progress)}%`;
  if (title !== lastEvent) {
    const event = document.createElement("li");
    event.textContent = title;
    $("events").append(event);
    while ($("events").children.length > 16) $("events").firstElementChild.remove();
    lastEvent = title;
  }
}
function enableActions() {
  buttons.forEach(button => { button.disabled = busy || needsReconnect || !release || !supported; });
  $("choose-firmware").disabled = busy;
  $("firmware-file").disabled = busy;
  $("use-online").disabled = busy || onlineLoading || !firmwareSource;
}
function unload(event) { if (busy) { event.preventDefault(); event.returnValue = ""; } }
window.addEventListener("beforeunload", unload);

async function run(mode) {
  if (busy || needsReconnect || !release || !supported) return;
  busy = true;
  enableActions();
  let port;
  try {
    state("选择设备", "请选择小纸 Pico 的 USB 串口。");
    // Request on the click's activation, before any downloads or asynchronous imports.
    port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
    let images = importedImages;
    if (!images) {
      state("下载固件", "从已锁定版本的发布源加载并校验完整发布包。", 2);
      images = await downloadParts(release, fraction =>
        state("下载固件", "正在检查 SHA-256 与镜像布局。", 2 + fraction * 15));
    }
    const result = await flashDevice({
      port, release, images, mode, onState: state,
      confirmInstall: (message) => window.confirm(message),
      loadDriver: () => import("./vendor/esptool-js.bundle.mjs"),
    });
    needsReconnect = result.closeFailed;
    state(mode === "install" ? "全新烧录完成" : "固件更新完成",
      "镜像与保护区域校验通过。请重新插拔数据线以重启设备。" +
        (result.closeFailed ? "串口未正常释放，重新插拔后请刷新页面。" : ""),
      100, "success");
  } catch (error) {
    needsReconnect = Boolean(error?.needsReconnect);
    const cancelled = error?.code === "CANCELLED" || error?.name === "NotFoundError";
    const downloadFailed = ["DOWNLOAD", "HASH", "MANIFEST", "IMAGE", "PARTITIONS"].includes(error?.code) && !importedImages;
    if (downloadFailed) $("firmware-fallback").open = true;
    state(cancelled ? "操作已取消" : "操作未完成",
      error instanceof FlashError ? error.message +
        (downloadFailed ? " 可使用下方展开的备用入口，从 GitHub 下载完整包后导入。" : "") :
        cancelled ? "没有写入设备。" : "串口选择失败，请检查浏览器权限后重试。",
      0, cancelled ? "ready" : "error");
  } finally {
    busy = false;
    enableActions();
  }
}
buttons.forEach((button) => button.addEventListener("click", () => run(button.id)));

function showRelease(filename = null) {
  const local = sourceMode === "local";
  $("firmware-mode").textContent = local ? "本地固件" : "在线固件";
  $("source-tag").textContent = local ? (release ? "已选择本地" : "备用方式") : "默认使用";
  $("source-hint").textContent = local
    ? release ? "将使用你导入的完整包。选择下方的烧录方式即可开始。" : "请在下方备用入口选择完整包，或切回在线固件。"
    : release ? "已自动选择最新正式版。直接点击下方按钮，网页会自动下载并校验固件。"
      : onlineLoading ? "正在获取最新正式版本。网页会自动下载并校验固件。"
        : "在线固件暂不可用。可重试加载，或使用下方展开的备用导入入口。";
  $("use-online").hidden = !local && (onlineLoading || Boolean(release));
  $("use-online").textContent = local ? "切回在线固件" : "重试在线加载";
  $("version").textContent = release?.manifest.version || "—";
  $("source").hidden = Boolean(filename) || !release;
  $("source-empty").hidden = !filename && Boolean(release);
  $("source-empty").textContent = filename ? `本地文件 · ${filename}` :
    local ? "未选择文件" : onlineLoading ? "正在加载" : "加载失败";
  $("release-notes").hidden = true;
  if (!release || filename) return;
  $("source").textContent = `${release.source.owner}/${release.source.repo} · ${release.tag || release.commit.slice(0, 7)}`;
  $("source").href = release.releaseUrl || `https://github.com/${release.source.owner}/${release.source.repo}/tree/${release.commit}`;
  $("release-notes-version").textContent = release.manifest.version;
  $("release-notes-body").textContent = release.releaseNotes?.trim() || "该版本暂未提供更新说明。";
  $("release-notes-history").replaceChildren();
  for (const item of release.history || []) {
    const details = document.createElement("details");
    details.className = "previous-release";
    const summary = document.createElement("summary");
    summary.textContent = `${item.version} · 更新说明`;
    const body = document.createElement("p");
    body.className = "release-note-text";
    body.textContent = item.releaseNotes.trim() || "该版本暂未提供更新说明。";
    const link = document.createElement("a");
    link.className = "release-note-link";
    link.textContent = "查看 Release";
    link.href = item.releaseUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    details.append(summary, body, link);
    $("release-notes-history").append(details);
  }
  $("release-notes").hidden = false;
}

async function loadOnline() {
  const generation = ++sourceGeneration;
  sourceMode = "online";
  release = null;
  importedImages = null;
  onlineLoading = true;
  showRelease();
  $("import-summary").textContent = "未选择本地文件。";
  $("firmware-fallback").open = location.hash === "#import-title";
  state("正在检查固件源", "默认使用在线固件，正在获取最新正式版本。", 0, "working");
  enableActions();
  try {
    if (!firmwareSource) throw new FlashError("SOURCE", "尚未配置在线固件源，可先导入本地完整包。");
    const loaded = await loadRelease(firmwareSource);
    // 在线响应晚到时，保留用户后来选择的本地文件。/ A late online response must not replace a newer local selection.
    if (generation !== sourceGeneration) return;
    release = loaded;
    showRelease();
    state(supported ? "可以开始" : "固件已识别",
      supported ? "在线固件已就绪。选择“固件更新”或“全新烧录”，按提示连接设备。" : "请用电脑 Chrome 或 Edge 打开此页进行烧录。", 0, "ready");
  } catch (error) {
    if (generation === sourceGeneration) {
      onlineLoading = false;
      showRelease();
      $("firmware-fallback").open = true;
      state("固件源不可用", (error instanceof FlashError ? error.message : "请检查网络或发布配置。") +
        " 可重试在线加载，或使用下方展开的备用导入入口。", 0, "error");
    }
  } finally {
    onlineLoading = false;
    enableActions();
  }
}

async function importFirmware(file) {
  if (busy || !file) return;
  ++sourceGeneration;
  sourceMode = "local";
  $("firmware-fallback").open = true;
  busy = true;
  release = null;
  importedImages = null;
  showRelease();
  enableActions();
  $("import-summary").textContent = `正在检查：${file.name}`;
  state("检查本地固件", "正在核对完整包、版本和文件完整性。", 0);
  try {
    if (!file.name.toLowerCase().endsWith(".bin") || file.size <= APP_ADDRESS || file.size > APP_ADDRESS + APP_SIZE) {
      throw new FlashError("BUNDLE", "请选择从 Release 下载的 whiteos-X.Y.Z-full.bin 完整包。");
    }
    const parsed = await splitMergedBundle(new Uint8Array(await file.arrayBuffer()));
    release = { manifest: parsed.manifest };
    importedImages = parsed.images;
    showRelease(file.name);
    $("import-summary").textContent = `已导入 ${parsed.manifest.version} · ${(file.size / 1024 / 1024).toFixed(2)} MB。文件仅在本机处理。`;
    state("本地固件已就绪", supported ? "点击“固件更新”或“全新烧录”，按提示选择设备。" : "请用电脑 Chrome 或 Edge 打开此页进行烧录。", 0, "ready");
  } catch (error) {
    $("import-summary").textContent = `导入失败：${file.name}`;
    state("导入未完成", (error instanceof FlashError ? error.message : "无法读取完整包，请重新下载。") +
      " 请重新选择文件，或点击“切回在线固件”。", 0, "error");
  } finally {
    $("firmware-file").value = "";
    busy = false;
    enableActions();
  }
}
$("choose-firmware").addEventListener("click", () => { if (!busy) $("firmware-file").click(); });
$("firmware-file").addEventListener("change", event => importFirmware(event.target.files?.[0]));
$("use-online").addEventListener("click", () => { if (!busy && !onlineLoading) loadOnline(); });
loadOnline();
window.addEventListener("hashchange", () => {
  if (location.hash === "#import-title") $("firmware-fallback").open = true;
});
