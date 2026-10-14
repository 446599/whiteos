const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const fixtures = process.env.PICO_DICTIONARY_FIXTURES;
const output = process.env.PICO_DICTIONARY_OUTPUT || path.join(fixtures, "browser");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml" };

(async () => {
  assert.ok(fixtures, "Set PICO_DICTIONARY_FIXTURES to generated synthetic fixtures");
  await fs.mkdir(output, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(fixtures, "manifest.json")));
  let server, browser;
  try {
    let url = process.env.PICO_DICTIONARY_URL;
    if (!url) {
      server = http.createServer(async (request, response) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
          const prefix = "/whiteos/";
          assert.ok(pathname.startsWith(prefix));
          let file = path.resolve(root, pathname.slice(prefix.length));
          assert.ok(file.startsWith(root + path.sep) || file === root);
          if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html");
          response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
          response.end(await fs.readFile(file));
        } catch { response.writeHead(404); response.end(); }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${server.address().port}/whiteos/dictionary/`;
    }
    browser = await chromium.launch({ headless: true, ...(process.env.PICO_SITE_BROWSER ? { executablePath: process.env.PICO_SITE_BROWSER } : {}) });
    const context = await browser.newContext();
    const requests = [];
    context.on("request", request => requests.push({ url: request.url(), method: request.method() }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    assert.ok(!requests.some(request => /\.wasm/.test(request.url)), "engine must load only on conversion");

    async function setFiles(names) {
      await page.locator("#files").setInputFiles(names.map(name => path.join(fixtures, name)));
    }
    async function waitResult() {
      await page.waitForFunction(() => !document.getElementById("result").hidden || document.getElementById("error").textContent, undefined, { timeout: 180000 });
      assert.equal(await page.locator("#error").textContent(), "");
    }
    for (const fixture of manifest.cases) {
      await setFiles(fixture.files);
      assert.equal(await page.locator("#convert").isDisabled(), false);
      await page.locator("#convert").click();
      await waitResult();
      assert.ok((await page.locator("#result-summary").textContent()).startsWith(fixture.stats.entries.toLocaleString()));
      const downloading = page.waitForEvent("download");
      await page.locator("#download").click();
      const download = await downloading;
      assert.equal(download.suggestedFilename(), "dictionary.pdict");
      const target = path.join(output, fixture.name + ".pdict");
      await download.saveAs(target);
      assert.deepEqual(await fs.readFile(target), await fs.readFile(path.join(fixtures, fixture.expected)), fixture.name + ": browser output differs from desktop");
      if (process.env.PICO_DICTIONARY_LOOKUP) {
        await execFile(process.env.PICO_DICTIONARY_LOOKUP, [target, fixture.query, "2", fixture.definition]);
        await execFile(process.env.PICO_DICTIONARY_LOOKUP, [target, "__missing_query__", "3", ""]);
      }
      console.log(`Converted and validated ${fixture.name}: ${fixture.stats.entries} entries`);
    }
    for (const name of manifest.bad) {
      await setFiles([name]);
      await page.locator("#convert").click();
      await page.locator("#error").filter({ hasText: "转换失败" }).waitFor();
      assert.equal(await page.locator("#result").isVisible(), false);
      assert.equal(await page.locator("#download").getAttribute("href"), null);
      console.log(`Rejected invalid ${name}`);
    }
    await setFiles(["star-32-False.ifo"]);
    assert.equal(await page.locator("#convert").isDisabled(), true);
    assert.match(await page.locator("#error").textContent(), /缺少配套/);
    await setFiles(["simple.csv", "bom.txt"]);
    assert.equal(await page.locator("#convert").isDisabled(), true);

    // Cancel both engine preparation and actual conversion, then prove retry works.
    await setFiles(["large.tsv"]);
    await page.locator("#convert").click();
    await page.locator("#cancel").click();
    assert.equal(await page.locator("#result").isVisible(), false);
    assert.equal(await page.locator("#convert").isDisabled(), false);
    await page.locator("#convert").click();
    await page.locator("#status").filter({ hasText: "已读取" }).waitFor({ timeout: 180000 });
    const responsiveness = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(true), 20)));
    assert.equal(responsiveness, true);
    await page.locator("#cancel").click();
    assert.equal(await page.locator("#result").isVisible(), false);
    await setFiles(["simple.csv"]);
    await page.locator("#convert").click();
    await waitResult();
    console.log("Cancel, responsive page and retry: passed");
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => request.method === "GET" && new URL(request.url).origin === new URL(url).origin), "unexpected upload or external request");

    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      assert.equal(await page.locator('.converter-nav a[href="../"]').isVisible(), true);
      assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth)), true);
      await page.screenshot({ path: path.join(output, `layout-${width}.png`), fullPage: true });
    }
    await page.locator("#files").focus();
    assert.equal(await page.locator("#files").evaluate(element => element === document.activeElement), true);
    // The home navigation must expose the tool under the project URL prefix.
    await page.locator('.converter-nav a[href="../"]').click();
    const link = page.locator('#navigation a[href="./dictionary/"]');
    if (!await link.isVisible()) await page.locator(".menu-toggle").click();
    await link.click();
    await page.waitForURL(url);
    console.log(`Layout, keyboard, navigation, same-origin GET-only processing: passed (${requests.length} requests)`);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
