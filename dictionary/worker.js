// SPDX-License-Identifier: GPL-3.0-only
// Only fixed, same-origin engine resources are fetched; dictionaries stay in worker memory.
let engine;
let running = false;
const sources = ["importer.py", "web_adapter.py", "mdict_utils/__init__.py", "mdict_utils/base/__init__.py",
  "mdict_utils/base/readmdict.py", "mdict_utils/base/ripemd128.py", "mdict_utils/base/pureSalsa20.py"];
self.report_progress = (message, done = 0, total = 0) => postMessage({ type: "progress", message, done, total });

async function initialize() {
  importScripts("./vendor/pyodide/pyodide.js");
  const runtime = await loadPyodide({ indexURL: new URL("./vendor/pyodide/", self.location.href).href,
    stdout: () => {}, stderr: () => {}, packages: ["sqlite3"] });
  runtime.FS.mkdirTree("/converter");
  await Promise.all(sources.map(async name => {
    const response = await fetch(new URL("./python/" + name, self.location.href));
    if (!response.ok) throw new Error("转换程序下载失败，请检查网络后重试。");
    const target = "/converter/" + name;
    runtime.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    runtime.FS.writeFile(target, await response.text());
  }));
  runtime.runPython("import sys\nsys.path.insert(0, '/converter')\nfrom web_adapter import convert_web");
  return runtime;
}

self.onmessage = async ({ data }) => {
  if (running) return;
  running = true;
  try {
    const { selectDictionary } = await import("./selection.mjs");
    const selected = selectDictionary(data.files);
    if (selected.source !== data.source) throw new Error("所选主词库无效。");
    const runtime = await (engine ||= initialize());
    const run = "/dictionary-input";
    runtime.FS.mkdirTree(run);
    try {
      let loaded = 0;
      const total = selected.files.reduce((sum, file) => sum + file.size, 0);
      for (const file of selected.files) {
        self.report_progress("正在读取所选文件…", loaded, total);
        runtime.FS.writeFile(run + "/" + file.name, new Uint8Array(await file.arrayBuffer()));
        loaded += file.size;
      }
      runtime.globals.set("source_name", selected.source);
      self.report_progress("正在解析词库…");
      const stats = JSON.parse(runtime.runPython("convert_web(source_name)"));
      const bytes = runtime.FS.readFile(run + "/dictionary.pdict");
      postMessage({ type: "result", stats, buffer: bytes.buffer }, [bytes.buffer]);
    } finally {
      runtime.runPython("import shutil\nshutil.rmtree('/dictionary-input', ignore_errors=True)");
      runtime.globals.delete("source_name");
    }
  } catch (error) {
    const message = String(error.message || error).split("\n").filter(Boolean).pop();
    postMessage({ type: "error", message: "转换失败：" + message });
  } finally { running = false; }
};
