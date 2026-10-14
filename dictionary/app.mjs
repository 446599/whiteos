// SPDX-License-Identifier: GPL-3.0-only
import { selectDictionary } from "./selection.mjs";

const get = id => document.getElementById(id);
const input = get("files");
const convert = get("convert");
const cancel = get("cancel");
let selection;
let worker;
let busy = false;
let downloadURL;

function clearResult() {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = undefined;
  get("download").removeAttribute("href");
  get("result").hidden = true;
}

function finish() {
  busy = false;
  input.disabled = false;
  convert.disabled = !selection;
  cancel.hidden = true;
  get("progress-region").hidden = true;
  get("convert-heading").removeAttribute("aria-busy");
}

function choose(files) {
  if (busy) return;
  clearResult();
  get("error").textContent = "";
  get("selection-note").textContent = "";
  get("file-list").replaceChildren();
  for (const file of files.slice(0, 32)) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const size = document.createElement("span");
    name.textContent = file.name;
    size.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MiB`;
    row.append(name, size);
    get("file-list").append(row);
  }
  try {
    selection = selectDictionary(files);
    get("selection-note").textContent = selection.note;
    input.removeAttribute("aria-invalid");
  } catch (error) {
    selection = undefined;
    get("error").textContent = error.message;
    input.setAttribute("aria-invalid", "true");
  }
  convert.disabled = !selection;
}

input.addEventListener("change", () => choose([...input.files]));
const zone = get("drop-zone");
for (const event of ["dragover", "drop"]) zone.addEventListener(event, e => e.preventDefault());
zone.addEventListener("dragover", () => { if (!busy) zone.classList.add("dragging"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
zone.addEventListener("drop", event => { zone.classList.remove("dragging"); choose([...event.dataTransfer.files]); });

function fail(message) {
  get("error").textContent = message;
  worker?.terminate();
  worker = undefined;
  finish();
}

convert.addEventListener("click", () => {
  if (!selection || busy) return;
  clearResult();
  get("error").textContent = "";
  busy = true;
  input.disabled = true;
  convert.disabled = true;
  cancel.hidden = false;
  get("progress-region").hidden = false;
  get("progress").removeAttribute("value");
  get("status").textContent = "正在准备转换引擎；首次需要下载约 13 MB…";
  get("convert-heading").setAttribute("aria-busy", "true");
  try {
    if (!worker) {
      worker = new Worker(new URL("./worker.js", import.meta.url));
      worker.onerror = () => fail("转换引擎无法运行，请刷新页面并使用较新的电脑浏览器重试。");
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          get("status").textContent = data.message;
          if (data.total) { get("progress").max = data.total; get("progress").value = data.done; }
          else get("progress").removeAttribute("value");
        } else if (data.type === "error") fail(data.message);
        else if (data.type === "result") {
          downloadURL = URL.createObjectURL(new Blob([data.buffer], { type: "application/octet-stream" }));
          get("download").href = downloadURL;
          get("result-summary").textContent = `${data.stats.entries.toLocaleString()} 条词条 · ${(data.stats.bytes / 1024 / 1024).toFixed(2)} MiB`;
          get("result-details").textContent = `重复 ${data.stats.duplicates.toLocaleString()} 条，跳过 ${data.stats.skipped.toLocaleString()} 条，长释义节选 ${data.stats.excerpts.toLocaleString()} 条。`;
          finish();
          get("result").hidden = false;
          get("result-heading").focus();
        }
      };
    }
    worker.postMessage({ source: selection.source, files: selection.files });
  } catch { fail("此浏览器无法启动后台转换，请使用较新的电脑浏览器重试。"); }
});

cancel.addEventListener("click", () => {
  worker?.terminate();
  worker = undefined;
  finish();
  get("selection-note").textContent = "已取消，可以重新转换或选择另一份词库。";
  convert.focus();
});
