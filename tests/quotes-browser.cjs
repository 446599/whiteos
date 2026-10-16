const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = '/tmp/pico-quotes-browser-20261016';
(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/whiteos/')) throw Error();
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname.slice(8)));
      if (!file.startsWith(root + path.sep)) throw Error();
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.svg': 'image/svg+xml' })[path.extname(file)] || 'text/plain' });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.PICO_SITE_BROWSER ? { executablePath: process.env.PICO_SITE_BROWSER } : {}) });
  try {
    const base = `http://127.0.0.1:${server.address().port}/whiteos/`;
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      let upstream = 0;
      await page.route('https://raw.githubusercontent.com/**', route => { upstream++; return route.abort(); });
      await page.goto(base + 'quotes/'); assert.equal(upstream, 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByLabel('自己的句子').check();
      await page.locator('#quote-file').setInputFiles({ name: 'custom.tsv', mimeType: 'text/plain', buffer: Buffer.from('给平常的日子，留一点期待。\t测试作者\t测试作品\n读到喜欢的地方，就多停留一会儿。\t测试作者\t测试作品') });
      const downloadWait = page.waitForEvent('download');
      await page.locator('#build-pack').click(); const download = await downloadWait;
      const archive = path.join(output, `custom-${width}.zip`); await download.saveAs(archive);
      await page.getByText('已生成 2 条短句。', { exact: false }).waitFor();
      assert.equal(upstream, 0); assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `quotes-${width}.png`), fullPage: true });
      const verify = spawnSync('python3', ['-c', `import sys,zipfile,pathlib
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
assert 'QUOTES/source.json' in z.namelist() and 'QUOTES/rebuild.mjs' in z.namelist()
z.extractall(sys.argv[2])`, archive, path.join(output, `unpacked-${width}`)], { encoding: 'utf8' });
      assert.equal(verify.status, 0, verify.stderr);
      const folder = path.join(output, `unpacked-${width}/QUOTES`), before = await fs.readFile(path.join(folder, 'daily.pquotes'));
      const rebuild = spawnSync(process.execPath, [path.join(folder, 'rebuild.mjs')], { encoding: 'utf8' });
      assert.equal(rebuild.status, 0, rebuild.stderr); assert.deepEqual(before, await fs.readFile(path.join(folder, 'daily.pquotes')));
      await page.close();
    }
    const page = await browser.newPage();
    let mode = 'success';
    await page.route('https://raw.githubusercontent.com/**', async route => {
      if (mode === 'failure') return route.abort();
      if (mode === 'pending') return;
      const url = route.request().url();
      const body = url.endsWith('LICENSE') ? 'GNU AFFERO GENERAL PUBLIC LICENSE\nfixture only' : url.endsWith('README.md') ? 'Synthetic upstream usage notice' : JSON.stringify([{ hitokoto: '这是用于验证下载流程的原创短句。', from_who: '测试作者', from: url.includes('d.json') ? '文学测试' : '原创测试', uuid: 'synthetic-only' }]);
      await route.fulfill({ contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    });
    await page.goto(base + 'quotes/');
    const downloadWait = page.waitForEvent('download'); await page.locator('#build-pack').click();
    const upstreamZip = path.join(output, 'synthetic-upstream.zip'); await (await downloadWait).saveAs(upstreamZip);
    const verify = spawnSync('python3', ['-c', `import sys,zipfile
z=zipfile.ZipFile(sys.argv[1]);assert 'QUOTES/LICENSE.txt' in z.namelist();assert 'QUOTES/UPSTREAM-README.md' in z.namelist();assert b'07a74e13' in z.read('QUOTES/README.txt')`, upstreamZip], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
    await page.locator('#build-pack').waitFor({ state: 'visible' });
    mode = 'failure'; await page.locator('#build-pack').click(); await page.getByText('未生成句子包：', { exact: false }).waitFor(); assert.ok(await page.locator('#build-pack').isEnabled());
    mode = 'pending'; await page.locator('#build-pack').click(); await page.locator('#cancel-pack').click(); await page.getByText('已取消或下载超时', { exact: false }).waitFor();
    await page.goto(base + 'flash/'); await page.getByRole('link', { name: '准备句子包与查看导入方法' }).click(); assert.ok(page.url().endsWith('/quotes/'));
    await page.close();
    console.log('Quote browser: four widths, private local import, ZIP rebuild, upstream notices, failure, cancellation and flasher link passed.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
