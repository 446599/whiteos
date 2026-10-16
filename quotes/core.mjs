// SPDX-License-Identifier: MIT
// 中文：通用外置句库格式及无压缩 ZIP，不含第三方句子。/ English: Generic quote format and stored ZIP, without third-party text.
export const MAX_QUOTES = 4096;
export const REVISION = '07a74e13b572c2ad861d91f791788fd4253fc086';
const utf8 = new TextEncoder();
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function field(text, bytes, chars, allowEmpty = false) {
  return typeof text === 'string' && (allowEmpty || text.length > 0) &&
    utf8.encode(text).length < bytes && [...text].length <= chars &&
    !/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(text) &&
    !/[\ud800-\udfff]/u.test(text);
}
export function selectQuotes(input, limit = 1000, supported = null) {
  if (!Array.isArray(input) || input.length > 20000) throw new Error('句库必须是数组，最多 20,000 条。');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUOTES) throw new Error('句子数量超出范围。');
  const result = [], seen = new Set();
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const text = typeof (row.text ?? row.hitokoto) === 'string' ? (row.text ?? row.hitokoto).trim() : '';
    const author = typeof (row.author ?? row.from_who) === 'string' ? (row.author ?? row.from_who).trim() : '';
    const source = typeof (row.source ?? row.from) === 'string' ? (row.source ?? row.from).trim() : '';
    const credit = [author, source].filter(Boolean).join(' · ') || '自定义句库';
    if (!field(text, 128, 26) || !field(credit, 96, 32) || [...text].length < 8) continue;
    if (supported && [...text, ...credit].some(character => !supported.has(character))) continue;
    const key = text.replace(/\s/gu, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ text, author, source, credit, ...(typeof row.uuid === 'string' ? { sourceId: row.uuid } : {}) });
    if (result.length === limit) break;
  }
  if (!result.length) throw new Error('没有符合条件的短句。请使用 8～26 字，缩短作者、出处，并检查是否有界面字库不支持的字符。');
  return result;
}
export function compileQuotes(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_QUOTES) throw new Error('句库数量无效。');
  const bytes = new Uint8Array(24 + rows.length * 228), view = new DataView(bytes.buffer);
  bytes.set(utf8.encode('PQTS0001')); view.setUint32(8, rows.length, true); view.setUint32(12, 228, true);
  view.setUint32(20, crc32(bytes.subarray(0, 20)), true);
  rows.forEach((row, i) => {
    if (!field(row.text, 128, 26) || !field(row.credit, 96, 32, true)) throw new Error('短句或出处超出显示范围。');
    const start = 24 + i * 228;
    bytes.set(utf8.encode(row.text), start); bytes.set(utf8.encode(row.credit), start + 128);
    view.setUint32(start + 224, crc32(bytes.subarray(start, start + 224)), true);
  });
  return bytes;
}
export function parseInput(text) {
  if (utf8.encode(text).length > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MB。');
  text = text.replace(/^\ufeff/u, '').trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    let data; try { data = JSON.parse(text); } catch { throw new Error('JSON 格式不正确。'); }
    return Array.isArray(data) ? data : data.quotes;
  }
  return text.split(/\r?\n/u).filter(Boolean).map(line => {
    const [text, author = '', source = ''] = line.split('\t'); return { text, author, source };
  });
}
export function zipFiles(files) {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    if (!/^QUOTES\/[a-zA-Z0-9_.-]+$/u.test(name)) throw new Error('句子包文件名无效。');
    const filename = utf8.encode(name), data = typeof content === 'string' ? utf8.encode(content) : content;
    const crc = crc32(data), header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, filename.length, true); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, filename.length, true); c.setUint32(42, offset, true); central.set(filename, 46);
    chunks.push(header, data); directory.push(central); offset += header.length + data.length;
  }
  const size = directory.reduce((n, part) => n + part.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, directory.length, true); e.setUint16(10, directory.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + end.length); let cursor = 0;
  for (const part of [...chunks, ...directory, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}
