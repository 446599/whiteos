const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = process.env.PICO_SITE_ROOT || path.resolve(__dirname, "..");
const prefix = "/whiteos";
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!pathname.startsWith(`${prefix}/`)) throw new Error("Unexpected prefix");
      let file = path.resolve(root, `.${pathname.slice(prefix.length)}`);
      if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Invalid path");
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html");
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PICO_SITE_BROWSER ? { executablePath: process.env.PICO_SITE_BROWSER } : {}) });
    const base = `http://127.0.0.1:${server.address().port}${prefix}/`;
    for (const width of [320, 390, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__portRequests = 0;
        Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort() {
          window.__portRequests++;
          throw new Error("Navigation must not access a device");
        } } });
      });
      await page.route("**/flash/config.mjs*", route => route.fulfill({ contentType: "text/javascript", body: "export const firmwareSource = null;" }));
      for (const route of ["", "manual/", "install/", "flash/"]) {
        await page.goto(base + route);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route || "intro"}: overflow at ${width}`);
      }
      await page.goto(base);
      const entry = page.locator('#navigation a[href="./manual/"]');
      if (!await entry.isVisible()) await page.locator(".menu-toggle").click();
      await entry.click();
      await page.waitForURL(base + "manual/");
      assert.equal(await page.locator(".chapter").count(), 12);
      await page.locator('.document-bar a[href="../flash/"]').click();
      await page.waitForURL(base + "flash/");
      assert.equal(await page.locator("button").count(), 2);
      assert.equal(await page.evaluate(() => window.__portRequests), 0);
      await page.locator('.topbar-links a[href="../manual/"]').click();
      await page.waitForURL(base + "manual/");
      await page.locator('.document-bar a[href="../"]').click();
      await page.waitForURL(base);
      await page.goto(base + "install/");
      await page.locator('.install-nav a[href="../manual/"]').click();
      await page.waitForURL(base + "manual/");
      await page.locator("#search-input").fill("传书");
      await page.locator('#search-list a[href="#transfer"]').click();
      assert.equal(new URL(page.url()).hash, "#transfer");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Navigation at ${width}px: passed`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
