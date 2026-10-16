// SPDX-License-Identifier: MIT
// 中文：用户明确下载时才拉取外置句库，不接触串口或账号。/ English: Fetch only on explicit download, without serial/account access.
import { REVISION, selectQuotes, parseInput, compileQuotes, zipFiles } from './core.mjs?v=20261016-coverage';
const byId = id => document.getElementById(id);
let active = null;
const source = () => document.querySelector('input[name="source"]:checked').value;
function sourceChanged() {
  byId('custom-fields').hidden = source() !== 'custom';
  byId('source-license').hidden = source() !== 'hitokoto';
  byId('preview').hidden = true;
  byId('pack-status').textContent = '句子包独立于固件，不需要连接设备。';
}
for (const radio of document.querySelectorAll('input[name="source"]')) radio.addEventListener('change', sourceChanged);
async function textFile(url, signal, max = 4 * 1024 * 1024) {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw new Error('句库下载失败，请重试或导入自己的文件。');
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new Error('句库下载超出大小限制。'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let cursor = 0;
  for (const part of parts) { data.set(part, cursor); cursor += part.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}
const rebuild = `// SPDX-License-Identifier: MIT\nimport { readFile, writeFile } from 'node:fs/promises';\nimport { selectQuotes, compileQuotes, MAX_QUOTES } from './core.mjs?v=20261016-coverage';\nconst input = JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'));\nconst coverage = JSON.parse(await readFile(new URL('./coverage.json', import.meta.url), 'utf8'));\nconst rows = selectQuotes(input, MAX_QUOTES, new Set(coverage.characters));\nawait writeFile(new URL('./daily.pquotes', import.meta.url), compileQuotes(rows));\nconsole.log('已生成 ' + rows.length + ' 条句子');\n`;
byId('cancel-pack').addEventListener('click', () => active?.abort());
byId('build-pack').addEventListener('click', async () => {
  if (active) return;
  active = new AbortController(); const controller = active, kind = source();
  const timeout = setTimeout(() => controller.abort(), 45000);
  byId('build-pack').disabled = true; byId('cancel-pack').hidden = false;
  for (const radio of document.querySelectorAll('input[name="source"]')) radio.disabled = true;
  byId('quote-file').disabled = true; byId('preview').hidden = true;
  byId('pack-status').textContent = kind === 'hitokoto' ? '正在下载文学、原创句库及许可说明…' : '正在处理本机文件…';
  try {
    let input, extra = {}, attribution;
    if (kind === 'hitokoto') {
      const base = `https://raw.githubusercontent.com/hitokoto-osc/sentences-bundle/${REVISION}/`;
      const [literature, originals, license, readme] = await Promise.all([
        textFile(base + 'sentences/d.json', controller.signal), textFile(base + 'sentences/e.json', controller.signal),
        textFile(base + 'LICENSE', controller.signal, 128000), textFile(base + 'README.md', controller.signal, 64000),
      ]);
      const a = JSON.parse(literature), b = JSON.parse(originals);
      if (!Array.isArray(a) || !Array.isArray(b) || a.length + b.length > 20000 || !license.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) throw new Error('上游句库格式或许可发生变化，已停止生成。');
      // 文学与原创交错挑选，不把第一个分类填满整包。/ Interleave categories instead of filling the pack with only the first.
      input = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) input.push(a[i]); if (b[i]) input.push(b[i]); }
      extra = { 'QUOTES/LICENSE.txt': license, 'QUOTES/UPSTREAM-README.md': readme };
      attribution = `一言开源社区 sentences-bundle\n来源：https://github.com/hitokoto-osc/sentences-bundle\n固定版本：${REVISION}\n分类：d（文学）、e（原创）\n句库许可：AGPL-3.0，保留原作者及出处字段。部分引文权利归原作者，仓库许可不代替原文授权。\n`;
    } else {
      const file = byId('quote-file').files[0];
      if (!file) throw new Error('请先选择自己的句库文件。');
      if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MB。');
      input = parseInput(await file.text());
      attribution = '来源：用户选择的本机文件。\n句子授权沿用原始内容的许可，本工具不替内容重新授权。\n';
    }
    const [tool, toolLicense, coverageText] = await Promise.all([textFile(new URL('./core.mjs?v=20261016-coverage', import.meta.url), controller.signal), textFile(new URL('./LICENSE', import.meta.url), controller.signal), textFile(new URL('./coverage.json', import.meta.url), controller.signal)]);
    const coverage = JSON.parse(coverageText);
    if (typeof coverage.characters !== 'string') throw new Error('界面字库信息无效，已停止生成。');
    const rows = selectQuotes(input, 1000, new Set(coverage.characters));
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const notes = `小纸 Pico 外置每日一句\n\n${attribution}\n生成时间：${new Date().toISOString()}\n修改：筛选8～26字、去重、限制署名长度、跳过界面字库缺字条目并转换为PQTS0001格式；署名未经逐条原著校对。\n条数：${rows.length}\n\n导入：将整个 QUOTES 文件夹复制到TF卡根目录，然后安全弹出并返回主页。\n需要支持外置句库的新版固件，1.1.3暂不支持。\n\n可编辑数据：source.json。重新生成：安装Node.js后，在此目录执行 node rebuild.mjs。\n转换工具按MIT授权，句子内容保持自己的授权，详见 LICENSE.txt（如有）及原始来源。\n\n分发一言衍生句子包时，保留AGPL许可、来源、修改说明与对应可编辑数据，不额外限制接收者的许可权利。\n本外置格式可用于任意合法来源的句子；分开存放本身不免除第三方许可义务。\n`;
    const bytes = zipFiles({ 'QUOTES/daily.pquotes': compileQuotes(rows), 'QUOTES/source.json': JSON.stringify(rows, null, 2) + '\n',
      'QUOTES/README.txt': notes, 'QUOTES/rebuild.mjs': rebuild, 'QUOTES/core.mjs': tool, 'QUOTES/TOOL-LICENSE.txt': toolLicense, 'QUOTES/coverage.json': coverageText, ...extra });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'daily-quotes.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    byId('pack-status').textContent = `已生成 ${rows.length} 条短句。解压后，把 QUOTES 文件夹复制到 TF 卡根目录。`;
    byId('preview').textContent = `${rows[0].text}\n—— ${rows[0].credit}`; byId('preview').hidden = false;
  } catch (error) {
    byId('pack-status').textContent = controller.signal.aborted ? '已取消或下载超时，未生成句子包。可重新尝试。' : `未生成句子包：${error.message}`;
  } finally {
    controller.abort(); clearTimeout(timeout); active = null; byId('build-pack').disabled = false; byId('cancel-pack').hidden = true;
    for (const radio of document.querySelectorAll('input[name="source"]')) radio.disabled = false;
    byId('quote-file').disabled = false;
  }
});
