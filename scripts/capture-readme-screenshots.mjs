#!/usr/bin/env node
/**
 * Capture README screenshots (requires dev server on PORT).
 * Usage: node scripts/capture-readme-screenshots.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs", "screenshots");
const port = Number(process.env.PORT || 8080);
const base = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePaths = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function launchBrowser() {
  let lastErr;
  for (const executablePath of chromePaths) {
    try {
      return await puppeteer.launch({
        executablePath,
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1400,900"],
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("No Chrome/Chromium found");
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

  await page.goto(`${base}/`, { waitUntil: "networkidle0", timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById("btn-load-sample")?.click();
  });
  await sleep(400);

  await shot(page, "01-agenda-editor.png");

  await page.evaluate(() => {
    document.querySelector('[data-view="prompter"]')?.click();
  });
  await sleep(500);

  await page.evaluate(() => {
    const cb = document.getElementById("gaze-guide-enabled");
    if (cb) {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await sleep(400);
  await shot(page, "02-prompter-gaze-guide.png");

  await page.evaluate(() => {
    document.getElementById("btn-gaze-adjust")?.click();
  });
  await sleep(300);
  await shot(page, "03-gaze-guide-adjust.png");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
