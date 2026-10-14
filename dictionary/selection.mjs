// SPDX-License-Identifier: GPL-3.0-only
export const INPUT_LIMIT = 128 * 1024 * 1024;
const primary = /\.(mdx|ifo|csv|json|txt|tsv)$/i;

export function selectDictionary(files) {
  if (!files.length) throw new Error("请选择词典文件。");
  if (files.length > 32) throw new Error("一次最多选择 32 个文件，请只选择一份词库及其配套文件。");
  const names = new Set();
  let total = 0;
  for (const file of files) {
    if (!file.name || /[\\/\x00-\x1f\x7f]/.test(file.name) || file.name === "." || file.name === "..") throw new Error("文件名无效，请重命名后再选。");
    if (names.has(file.name.toLowerCase())) throw new Error("存在同名文件，请只保留一份。");
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error("无法读取文件大小。");
    names.add(file.name.toLowerCase());
    total += file.size;
  }
  if (total > INPUT_LIMIT) throw new Error("文件合计超过 128 MiB，请使用较小的词库或电脑转换工具。");
  const sources = files.filter(file => primary.test(file.name));
  if (sources.length !== 1) throw new Error("请只选择一份主词库：.mdx、.ifo、.csv、.json、.txt 或 .tsv。");
  const source = sources[0];
  const extension = source.name.match(primary)[1].toLowerCase();
  const stem = source.name.slice(0, -extension.length - 1);
  let selected = [source];
  let note = "已识别词库，点击开始转换。";
  if (extension === "ifo") {
    const find = suffix => files.find(file => file.name === stem + suffix);
    const index = find(".idx") || find(".idx.gz");
    const records = find(".dict") || find(".dict.dz");
    if (!index || !records) throw new Error("StarDict 缺少配套文件。请一起选择同名 .ifo、.idx（或 .idx.gz）、.dict（或 .dict.dz）。");
    selected = [source, index, records, ...(find(".syn") ? [find(".syn")] : [])];
    if (files.length !== selected.length) throw new Error("请只选择这份 StarDict 的同名配套文件；压缩版和未压缩版选一个即可。");
    note = "已识别 StarDict 配套文件，点击开始转换。";
  } else if (extension === "mdx") {
    if (files.some(file => file !== source && !/\.mdd$/i.test(file.name))) throw new Error("MDX 请只选择 .mdx 和可选的 .mdd 文件。");
    note = "已识别 MDX。仅转换文字释义，MDD 图片和发音不会导入。";
  } else if (files.length !== 1) throw new Error("文本词库每次只选一个文件。");
  return { source: source.name, files: selected, note };
}
