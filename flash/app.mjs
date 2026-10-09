import { firmwareSource } from "./config.mjs";
import { FlashError } from "./core.mjs";
import { loadRelease, downloadParts } from "./github.mjs";
import { flashDevice } from "./device.mjs";

const $ = (id) => document.getElementById(id);
const buttons = [$("install"), $("update")];
let release = null;
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
function enableActions() { buttons.forEach((button) => { button.disabled = busy || needsReconnect || !release || !supported; }); }
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
    state("下载固件", "从固定的 GitHub 发布提交加载并校验完整发布包。", 2);
    const images = await downloadParts(release, (fraction) =>
      state("下载固件", "正在检查 SHA-256 与镜像布局。", 2 + fraction * 15));
    const result = await flashDevice({
      port, release, images, mode, onState: state,
      confirmInstall: (message) => window.confirm(message),
      loadDriver: () => import("./vendor/esptool-js.bundle.mjs"),
    });
    needsReconnect = result.closeFailed;
    state(mode === "install" ? "全新烧录完成" : "固件更新完成",
      result.closeFailed ? "镜像与保护区域校验通过。串口未正常释放，请拔插 USB 并刷新页面。" :
        result.resetFailed ? "镜像与保护区域校验通过。请手动重新启动设备。" : "镜像与保护区域校验通过，设备已发送重启指令。",
      100, "success");
  } catch (error) {
    needsReconnect = Boolean(error?.needsReconnect);
    const cancelled = error?.code === "CANCELLED" || error?.name === "NotFoundError";
    state(cancelled ? "操作已取消" : "操作未完成",
      error instanceof FlashError ? error.message :
        cancelled ? "没有写入设备。" : "串口选择失败，请检查浏览器权限后重试。",
      0, cancelled ? "ready" : "error");
  } finally {
    busy = false;
    enableActions();
  }
}
buttons.forEach((button) => button.addEventListener("click", () => run(button.id)));

async function initialize() {
  if (!supported) {
    state("当前浏览器无法烧录", "请在电脑 Chrome 或 Edge 中，通过 HTTPS 或 localhost 打开此页。", 0, "error");
    return;
  }
  if (!firmwareSource) {
    state("等待固件发布", "尚未配置公开 GitHub 固件源。当前不会连接或写入设备。", 0, "ready");
    return;
  }
  try {
    release = await loadRelease(firmwareSource);
    $("version").textContent = release.manifest.version;
    $("source").textContent = `${release.source.owner}/${release.source.repo} · ${release.commit.slice(0, 7)}`;
    $("source").href = `https://github.com/${release.source.owner}/${release.source.repo}/tree/${release.commit}`;
    $("source").hidden = false;
    $("source-empty").hidden = true;
    state("可以开始", "尚未连接设备。", 0, "ready");
  } catch (error) {
    state("固件源不可用", error instanceof FlashError ? error.message : "请检查发布配置。", 0, "error");
  }
  enableActions();
}
initialize();
