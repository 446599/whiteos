const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = process.env.PICO_SITE_ROOT || path.resolve(__dirname, "..");
const output = process.env.PICO_SITE_TEST_OUTPUT || "/tmp/whiteos-import-browser-20261016";

const fakeDriver = `
import { md5 } from "../core.mjs";
export class Transport {
  async disconnect() {
    window.__flash.closed = true;
    if (window.__flash.options.closeFailure) throw new Error("Fake close failure");
    window.__flash.port.readable = null;
  }
}
export class ESPLoader {
  constructor() { this.chip = { CHIP_NAME: "ESP32-S3" }; this.IS_STUB = true; }
  async main() { window.__flash.connected++; window.__flash.port.readable = {}; }
  async detectFlashSize() { return "16MB"; }
  async getSecurityInfo() { return { chipId: 9, flags: 0, flashCryptCnt: 0 }; }
  async readFlash() { throw new Error("Streamed Flash reads must not be used"); }
  async flashMd5sum(address, size) { return md5(window.__flash.memory.subarray(address, address + size)); }
  async writeFlash(options) {
    if (options.eraseAll || options.flashMode !== "keep" || options.flashSize !== "keep") throw new Error("Unsafe options");
    for (const [index, file] of options.fileArray.entries()) {
      window.__flash.writes.push(file.address);
      window.__flash.memory.set(file.data, file.address);
      options.reportProgress(index, 1, 2);
      await new Promise((resolve) => setTimeout(resolve, window.__flash.options.writeDelay || 60));
      options.reportProgress(index, 2, 2);
    }
  }
  async after() {
    if (window.__flash.options.resetFailure) throw new Error("Fake reset failure");
    window.__flash.reset = true;
  }
}`;

(async () => {
  const { syntheticRelease, mergeImages, completeImage } = await import(pathToFileURL(path.join(__dirname, "flash-fixtures.mjs")));
  const fixture = await syntheticRelease();
  const imported = new Map(fixture.images);
  imported.set("application", completeImage(8224, "1.1.3"));
  const fullPayload = { name: "whiteos-1.1.3-full.bin", mimeType: "application/octet-stream", buffer: Buffer.from(mergeImages(imported)) };
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const filename = path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!filename.startsWith(root + path.sep)) throw new Error("Invalid path");
      const bytes = await fs.readFile(filename);
      const types = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript",
        ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
      response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream" });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/flash/`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PICO_SITE_BROWSER ? { executablePath: process.env.PICO_SITE_BROWSER } : {}),
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/flash/config.mjs*", (route) => route.fulfill({
      contentType: "text/javascript", body: "export const firmwareSource = null;",
    }));
    for (const [width, height] of [[1440, 900], [375, 812], [320, 568], [768, 1024], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await page.waitForFunction(() => document.getElementById("status-title").textContent !== "正在检查固件源");
      assert.equal(await page.locator("button").count(), 4);
      assert.equal(await page.locator("#install").textContent().then((text) => text.trim()), "全新烧录");
      assert.equal(await page.locator("#update").textContent().then((text) => text.trim()), "固件更新");
      assert.equal(await page.locator("#install").isDisabled(), true);
      assert.equal(await page.locator("#update").isDisabled(), true);
      const layout = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        broken: [...document.images].filter((image) => !image.complete || !image.naturalWidth).length,
      }));
      assert.ok(layout.scroll <= layout.width, `${width}: horizontal overflow`);
      assert.equal(layout.broken, 0);
      await page.screenshot({ path: path.join(output, `${width}x${height}.png`), fullPage: true });
    }
    const driver = await page.evaluate(async () => {
      const module = await import("./vendor/esptool-js.bundle.mjs");
      return { loader: typeof module.ESPLoader, transport: typeof module.Transport };
    });
    assert.deepEqual(driver, { loader: "function", transport: "function" });
    await page.close();

    async function scenario(options = {}) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(({ options, table }) => {
        const memory = new Uint8Array(0x1000000).fill(0xff);
        memory.set(table, 0x8000);
        const port = { readable: null };
        if (options.importDelay) {
          const read = File.prototype.arrayBuffer;
          File.prototype.arrayBuffer = async function () {
            await new Promise(resolve => setTimeout(resolve, options.importDelay));
            return read.call(this);
          };
        }
        window.__flash = { memory, port, options, requests: 0, connected: 0, writes: [], closed: false, activation: false };
        Object.defineProperty(navigator, "serial", {
          configurable: true,
          value: {
            async requestPort() {
              window.__flash.requests++;
              window.__flash.activation = navigator.userActivation.isActive;
              if (options.cancelSelect) throw new DOMException("Cancelled", "NotFoundError");
              return port;
            },
          },
        });
      }, { options, table: [...fixture.images.get("partitions")] });
      const releaseSource = { type: "release", owner: "synthetic", repo: "test-firmware", indexPath: "../firmware/releases.json" };
      await context.route("**/flash/config.mjs*", (route) => route.fulfill({
        contentType: "text/javascript", body: `export const firmwareSource = ${JSON.stringify(options.releaseMirror ? releaseSource : fixture.release.source)};`,
      }));
      if (options.releaseMirror) {
        await context.route("**/firmware/releases.json", route => route.fulfill({
          contentType: "application/json", body: JSON.stringify({ schema: 1, latest: {
            tag: "v1.0.0", version: "1.0.0", manifestPath: "releases/v1.0.0/manifest.json",
            releaseUrl: "https://github.com/synthetic/test-firmware/releases/tag/v1.0.0",
          } }),
        }));
        await context.route("**/firmware/releases/v1.0.0/*", route => {
          const resource = route.request().url();
          if (resource.endsWith("manifest.json")) return route.fulfill({ contentType: "application/json",
            body: JSON.stringify({ ...fixture.release.manifest, version: "1.0.0" }) });
          const part = fixture.release.manifest.parts.find(part => resource.endsWith(part.file));
          return route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(fixture.images.get(part.role)) });
        });
      }
      await context.route("https://api.github.com/**", (route) => route.fulfill({
        contentType: "application/json", body: JSON.stringify({ sha: fixture.release.commit }),
      }));
      await context.route("https://raw.githubusercontent.com/**", async (route) => {
        const resource = route.request().url();
        if (resource.endsWith("manifest.json")) {
          if (options.onlineDelay) await new Promise(resolve => setTimeout(resolve, options.onlineDelay));
          return route.fulfill({
          contentType: "application/json", body: JSON.stringify(fixture.release.manifest),
        }); }
        const part = fixture.release.manifest.parts.find((part) => resource.endsWith(part.file));
        return route.fulfill({
          contentType: "application/octet-stream",
          body: options.badHash ? Buffer.from("bad") : Buffer.from(fixture.images.get(part.role)),
        });
      });
      await context.route("**/flash/vendor/esptool-js.bundle.mjs", (route) => route.fulfill({
        contentType: "text/javascript", body: fakeDriver,
      }));
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      if (!options.skipReady) await page.waitForFunction(() => !document.getElementById("update").disabled);
      assert.equal(await page.evaluate(() => window.__flash.requests), 0, "Never connect on page load");
      return { context, page };
    }

    const defaultOnline = await scenario();
    assert.equal(await defaultOnline.page.locator("#firmware-mode").textContent(), "在线固件");
    assert.equal(await defaultOnline.page.locator("#source-tag").textContent(), "默认使用");
    assert.match(await defaultOnline.page.locator("#source-hint").textContent(), /直接点击下方按钮/);
    assert.equal(await defaultOnline.page.locator("#firmware-fallback").evaluate(e => e.open), false);
    assert.equal(await defaultOnline.page.locator("#choose-firmware").isVisible(), false);
    assert.equal(await defaultOnline.page.locator("#release-download").isVisible(), false);
    assert.equal(await defaultOnline.page.locator("#use-online").isVisible(), false);
    assert.ok(await defaultOnline.page.evaluate(() => document.getElementById("update").getBoundingClientRect().top < document.getElementById("import-title").getBoundingClientRect().top));
    await defaultOnline.page.screenshot({ path: path.join(output, "online-default-desktop.png"), fullPage: true });
    await defaultOnline.page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await defaultOnline.page.evaluate(() => document.getElementById("update").getBoundingClientRect().bottom < innerHeight));
    await defaultOnline.page.screenshot({ path: path.join(output, "online-default-mobile.png"), fullPage: true });
    await defaultOnline.page.reload();
    await defaultOnline.page.waitForFunction(() => !document.getElementById("update").disabled);
    assert.equal(await defaultOnline.page.locator("#firmware-fallback").evaluate(e => e.open), false);
    await defaultOnline.context.close();

    for (const mode of ["install", "update"]) {
      const { context, page } = await scenario();
      page.on("dialog", (dialog) => dialog.accept());
      await page.locator(`#${mode}`).click();
      await page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
      const state = await page.evaluate(() => ({ writes: window.__flash.writes, requests: window.__flash.requests,
        activation: window.__flash.activation, closed: window.__flash.closed, reset: window.__flash.reset }));
      assert.deepEqual(state.writes, mode === "install" ? [0, 0x8000, 0x10000] : [0x10000]);
      assert.equal(state.requests, 1);
      assert.equal(state.activation, true);
      assert.equal(state.closed, true);
      assert.equal(state.reset, true);
      assert.equal(await page.locator("#progress").getAttribute("value"), "100");
      assert.match(await page.locator("#status-detail").textContent(), /请重新插拔数据线以重启设备/);
      await page.screenshot({ path: path.join(output, `${mode}-success.png`) });
      await context.close();
    }
    for (const options of [{ badHash: true }, { cancelSelect: true }, { cancelConfirm: true }]) {
      const { context, page } = await scenario(options);
      page.on("dialog", (dialog) => dialog.dismiss());
      await page.locator(options.cancelConfirm ? "#install" : "#update").click();
      await page.waitForFunction(() => ["操作已取消", "操作未完成"].includes(document.getElementById("status-title").textContent));
      const state = await page.evaluate(() => ({ writes: window.__flash.writes, connected: window.__flash.connected }));
      assert.equal(state.writes.length, 0);
      if (!options.cancelConfirm) assert.equal(state.connected, 0);
      if (options.badHash) {
        assert.match(await page.locator("#status-detail").textContent(), /完整包后导入/);
        assert.equal(await page.locator("#firmware-fallback").evaluate(e => e.open), true);
        assert.equal(await page.locator("#firmware-mode").textContent(), "在线固件");
        assert.equal(await page.locator("#choose-firmware").isVisible(), true);
      }
      assert.equal(await page.locator("#update").isDisabled(), false);
      await context.close();
    }
    const closing = await scenario({ closeFailure: true });
    await closing.page.locator("#update").click();
    await closing.page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
    assert.equal(await closing.page.locator("#update").isDisabled(), true);
    assert.match(await closing.page.locator("#status-detail").textContent(), /请重新插拔数据线以重启设备/);
    assert.match(await closing.page.locator("#status-detail").textContent(), /请刷新页面/);
    await closing.context.close();

    const resetFailure = await scenario({ resetFailure: true });
    await resetFailure.page.locator("#update").click();
    await resetFailure.page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
    assert.match(await resetFailure.page.locator("#status-detail").textContent(), /请重新插拔数据线以重启设备/);
    assert.doesNotMatch(await resetFailure.page.locator("#status-detail").textContent(), /已发送重启指令/);
    await resetFailure.context.close();

    const repeated = await scenario({ writeDelay: 500 });
    await repeated.page.locator("#update").focus();
    await repeated.page.locator("#update").press("Enter");
    assert.equal(await repeated.page.locator("#install").isDisabled(), true);
    await repeated.page.evaluate(() => document.getElementById("update").dispatchEvent(new MouseEvent("click")));
    await repeated.page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
    assert.equal(await repeated.page.evaluate(() => window.__flash.requests), 1);
    assert.deepEqual(await repeated.page.evaluate(() => window.__flash.writes), [0x10000]);
    await repeated.context.close();

    for (const mode of ["install", "update"]) {
      const mirror = await scenario({ releaseMirror: true });
      mirror.page.on("dialog", dialog => dialog.accept());
      assert.equal(await mirror.page.locator("#version").textContent(), "1.0.0");
      assert.equal(await mirror.page.locator("#source").getAttribute("href"), "https://github.com/synthetic/test-firmware/releases/tag/v1.0.0");
      await mirror.page.locator(`#${mode}`).click();
      await mirror.page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
      assert.deepEqual(await mirror.page.evaluate(() => window.__flash.writes), mode === "install" ? [0, 0x8000, 0x10000] : [0x10000]);
      await mirror.context.close();
    }

    for (const mode of ["install", "update"]) {
      const local = await scenario({ badHash: true });
      local.page.on("dialog", dialog => dialog.accept());
      await local.page.locator("#firmware-file").setInputFiles(fullPayload);
      await local.page.waitForFunction(() => document.getElementById("status-title").textContent === "本地固件已就绪");
      assert.equal(await local.page.locator("#version").textContent(), "1.1.3");
      assert.equal(await local.page.locator("#source").isHidden(), true);
      assert.equal(await local.page.locator("#firmware-mode").textContent(), "本地固件");
      assert.equal(await local.page.locator("#use-online").isVisible(), true);
      assert.equal(await local.page.locator("#release-notes").isHidden(), true);
      await local.page.locator(`#${mode}`).click();
      await local.page.waitForFunction(() => document.getElementById("status-dot").dataset.state === "success");
      assert.deepEqual(await local.page.evaluate(() => window.__flash.writes), mode === "install" ? [0, 0x8000, 0x10000] : [0x10000]);
      assert.equal(await local.page.evaluate(() => window.__flash.memory[0x10000 + 48]), 49);
      await local.page.reload();
      await local.page.waitForFunction(() => !document.getElementById("update").disabled);
      assert.equal(await local.page.locator("#firmware-mode").textContent(), "在线固件");
      assert.equal(await local.page.locator("#firmware-fallback").evaluate(e => e.open), false);
      await local.context.close();
    }
    const failure = await scenario();
    const broken = { ...fullPayload, buffer: Buffer.from(fullPayload.buffer) };
    broken.buffer[0x10000 + 100] ^= 1;
    for (let attempt = 0; attempt < 2; attempt++) {
      await failure.page.locator("#firmware-file").setInputFiles(broken);
      await failure.page.waitForFunction(() => document.getElementById("status-title").textContent === "导入未完成");
      assert.equal(await failure.page.locator("#update").isDisabled(), true);
      assert.equal(await failure.page.locator("#version").textContent(), "—");
      assert.equal(await failure.page.locator("#firmware-file").inputValue(), "");
    }
    assert.equal(await failure.page.evaluate(() => window.__flash.requests), 0);
    await failure.page.locator("#use-online").click();
    await failure.page.waitForFunction(() => !document.getElementById("update").disabled);
    assert.equal(await failure.page.locator("#version").textContent(), fixture.release.manifest.version);
    assert.equal(await failure.page.locator("#firmware-mode").textContent(), "在线固件");
    assert.equal(await failure.page.locator("#firmware-fallback").evaluate(e => e.open), false);
    assert.equal(await failure.page.locator("#use-online").isVisible(), false);
    await failure.context.close();

    const importing = await scenario({ importDelay: 600 });
    await importing.page.locator("#firmware-file").setInputFiles(fullPayload);
    await importing.page.waitForFunction(() => document.getElementById("status-title").textContent === "检查本地固件");
    assert.equal(await importing.page.locator("#update").isDisabled(), true);
    assert.equal(await importing.page.locator("#choose-firmware").isDisabled(), true);
    assert.equal(await importing.page.locator("#use-online").isDisabled(), true);
    await importing.page.evaluate(() => document.getElementById("update").dispatchEvent(new MouseEvent("click")));
    assert.equal(await importing.page.evaluate(() => window.__flash.requests), 0);
    await importing.page.waitForFunction(() => document.getElementById("status-title").textContent === "本地固件已就绪");
    await importing.context.close();

    const racing = await scenario({ onlineDelay: 700, skipReady: true });
    await racing.page.locator("#firmware-file").setInputFiles(fullPayload);
    await racing.page.waitForFunction(() => document.getElementById("status-title").textContent === "本地固件已就绪");
    await racing.page.waitForFunction(() => !document.getElementById("use-online").disabled);
    assert.equal(await racing.page.locator("#version").textContent(), "1.1.3");
    assert.match(await racing.page.locator("#source-empty").textContent(), /本地文件/);
    await racing.page.screenshot({ path: path.join(output, "local-import-desktop.png"), fullPage: true });
    await racing.page.setViewportSize({ width: 390, height: 844 });
    await racing.page.locator(".download-guide").evaluate(element => element.open = true);
    assert.ok(await racing.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await racing.page.screenshot({ path: path.join(output, "local-import-mobile.png"), fullPage: true });
    await racing.context.close();

    const failedRace = await scenario({ onlineDelay: 600, skipReady: true });
    await failedRace.page.locator("#firmware-file").setInputFiles(broken);
    await failedRace.page.waitForFunction(() => document.getElementById("status-title").textContent === "导入未完成");
    await failedRace.page.waitForFunction(() => !document.getElementById("use-online").disabled);
    assert.equal(await failedRace.page.locator("#version").textContent(), "—");
    assert.equal(await failedRace.page.locator("#update").isDisabled(), true);
    assert.equal(await failedRace.page.evaluate(() => window.__flash.requests), 0);
    await failedRace.context.close();

    const unavailable = await scenario({ skipReady: true, onlineDelay: 50 });
    await unavailable.context.route("https://raw.githubusercontent.com/**", route => route.fulfill({ status: 503, body: "unavailable" }));
    await unavailable.page.reload();
    await unavailable.page.waitForFunction(() => document.getElementById("status-title").textContent === "固件源不可用");
    assert.equal(await unavailable.page.locator("#firmware-fallback").evaluate(e => e.open), true);
    assert.equal(await unavailable.page.locator("#use-online").textContent(), "重试在线加载");
    assert.equal(await unavailable.page.locator("#update").isDisabled(), true);
    assert.equal(await unavailable.page.evaluate(() => window.__flash.requests), 0);
    await unavailable.context.unroute("https://raw.githubusercontent.com/**");
    await unavailable.context.route("https://raw.githubusercontent.com/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture.release.manifest) }));
    await unavailable.page.locator("#use-online").click();
    await unavailable.page.waitForFunction(() => !document.getElementById("update").disabled);
    assert.equal(await unavailable.page.locator("#firmware-fallback").evaluate(e => e.open), false);
    await unavailable.context.close();

    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const noScriptPage = await noScript.newPage();
    await noScriptPage.goto(url);
    assert.equal(await noScriptPage.locator("noscript").isVisible(), true);
    assert.equal(await noScriptPage.locator("#install").isDisabled(), true);
    await noScript.close();

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(url);
    assert.equal(await reducedPage.locator("#update").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    await reduced.close();

    const unsupported = await browser.newContext();
    await unsupported.addInitScript(() => Object.defineProperty(navigator, "serial", { configurable: true, value: undefined }));
    await unsupported.route("**/flash/config.mjs*", (route) => route.fulfill({
      contentType: "text/javascript", body: `export const firmwareSource = ${JSON.stringify(fixture.release.source)};`,
    }));
    await unsupported.route("https://api.github.com/**", (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ sha: fixture.release.commit }),
    }));
    await unsupported.route("https://raw.githubusercontent.com/**", (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify(fixture.release.manifest),
    }));
    const unsupportedPage = await unsupported.newPage();
    await unsupportedPage.goto(url);
    await unsupportedPage.waitForFunction(() => document.getElementById("status-title").textContent === "固件已识别");
    assert.equal(await unsupportedPage.locator("#version").textContent(), fixture.release.manifest.version);
    assert.equal(await unsupportedPage.locator("#install").isDisabled(), true);
    await unsupported.close();
    assert.deepEqual(errors, []);
    console.log("PASS: online default/clear source, collapsed fallback/failure expansion/retry, 5 viewports, import validation, late-online race, source switching, reselect, busy guards, bundled driver, fixed GitHub source, both flows, keyboard, repeat-click guard, activation, cancellation, hash rejection, close failure, reduced motion and no-JS. No real device used.");
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
