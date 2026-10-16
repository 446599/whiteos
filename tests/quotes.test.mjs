import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseInput, selectQuotes, compileQuotes, zipFiles, crc32, MAX_QUOTES } from '../quotes/core.mjs';
const rows = () => selectQuotes([{ text: '给平常的日子，留一点期待。', author: '测试作者', source: '测试作品' }, { hitokoto: '读到喜欢的地方，就多停留一会儿。', from: '测试来源' }]);
test('quote import preserves text and source while excluding invalid and duplicate records', () => {
  const input = parseInput('\ufeff给平常的日子，留一点期待。\t测试作者\t测试作品\n给平常的日子，留一点期待。\t重复\n');
  const selected = selectQuotes([...input, null, {}, { text: '短句' }, { text: '文字中有\u202e隐藏控制符号。' }, { text: '字'.repeat(27) }, { text: '这是一个符合长度的句子。', author: '名'.repeat(40) }]);
  assert.equal(selected.length, 1); assert.equal(selected[0].author, '测试作者'); assert.equal(selected[0].credit, '测试作者 · 测试作品');
  assert.throws(() => selectQuotes([])); assert.throws(() => selectQuotes(Array(20001).fill({}))); assert.throws(() => parseInput('[invalid'));
  assert.throws(() => compileQuotes([{ text: '不合法\ud800字段', credit: '' }]));
  assert.equal(selectQuotes(parseInput(JSON.stringify({ quotes: rows() }))).length, 2);
});
test('fixed records and CRCs agree with independent Python struct/zlib implementation', () => {
  const records = rows(), actual = compileQuotes(records);
  const check = spawnSync('python3', ['-c', `import sys,json,struct,zlib,base64
rows=json.load(sys.stdin)
h=struct.pack('<8sIII',b'PQTS0001',len(rows),228,0)
out=h+struct.pack('<I',zlib.crc32(h))
for row in rows:
 b=struct.pack('<128s96s',row['text'].encode(),row['credit'].encode())
 out+=b+struct.pack('<I',zlib.crc32(b))
sys.stdout.write(base64.b64encode(out).decode())`], { input: JSON.stringify(records), encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr); assert.deepEqual(Buffer.from(actual), Buffer.from(check.stdout, 'base64'));
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(compileQuotes(Array(MAX_QUOTES).fill(records[0])).length, 24 + 228 * MAX_QUOTES);
  assert.throws(() => compileQuotes(Array(MAX_QUOTES + 1).fill(records[0])));
});
test('download archive is readable by independent zipfile and includes editable source and notices', () => {
  const files = { 'QUOTES/daily.pquotes': compileQuotes(rows()), 'QUOTES/source.json': JSON.stringify(rows()), 'QUOTES/README.txt': '测试来源与许可' };
  const result = zipFiles(files);
  const check = spawnSync('python3', ['-c', `import sys,io,zipfile,json,base64
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))`], { input: result, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const unpacked = JSON.parse(check.stdout);
  for (const [name, content] of Object.entries(files)) assert.deepEqual(Buffer.from(unpacked[name], 'base64'), Buffer.from(content));
  assert.throws(() => zipFiles({ '../outside.txt': 'no' }));
});

test('quote generation omits unsupported UI glyphs and preserves supported credits', () => {
  const coverage = JSON.parse(readFileSync(new URL('../quotes/coverage.json', import.meta.url), 'utf8'));
  const available = new Set(coverage.characters);
  const input = [...rows(), { text: '生活中也可以多一些期待😀', author: '测试作者' }];
  assert.equal(selectQuotes(input, 1000, available).length, 2);
  assert.ok([...rows()[0].text].every(c => available.has(c)));
});
