/**
 * Capture the live ProphetGrid flagship terminal session for the demo reel.
 *
 * The signing key for the desk is read from the CAPTURE_DESK_KEY environment
 * variable and written only into browser localStorage for this session. It is
 * never printed and never stored in the repository.
 *
 * Usage: CAPTURE_DESK_KEY=0x... node scripts/capture_terminal_session.mjs <baseUrl> <outWebm>
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4176/prophet-grid/";
const outPath = process.argv[3] ?? join(root, ".build", "terminal-session.webm");
const deskKey = process.env.CAPTURE_DESK_KEY ?? "";
const deskAddress = process.env.CAPTURE_DESK_ADDRESS ?? "";

mkdirSync(dirname(outPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: join(root, ".build", "video-raw"), size: { width: 1280, height: 720 } },
});

if (deskKey) {
  await context.addInitScript(
    ([key, address]) => {
      window.localStorage.setItem("prophetgrid.desk.slot", "0");
      window.localStorage.setItem("prophetgrid.desk.secret.0", key);
      window.localStorage.setItem("prophetgrid.desk.seed.address", address);
    },
    [deskKey, deskAddress],
  );
}

const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.slice(0, 180)}`));
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 180)}`);
});

const wait = (ms) => new Promise((accept) => setTimeout(accept, ms));
const move = async (x, y, steps = 12) => {
  await page.mouse.move(x, y, { steps });
};
const click = async (locator, settle = 700) => {
  await locator.first().click({ position: { x: 12, y: 8 } });
  await wait(settle);
};
const slide = async (locator, to, settle = 500) => {
  const box = await locator.first().boundingBox();
  if (!box) return;
  const from = await locator.first().evaluate((element) => Number(element.value));
  const min = await locator.first().evaluate((element) => Number(element.min));
  const max = await locator.first().evaluate((element) => Number(element.max));
  const startX = box.x + ((from - min) / (max - min)) * box.width;
  const endX = box.x + ((to - min) / (max - min)) * box.width;
  await move(startX, box.y + box.height / 2, 6);
  await page.mouse.down();
  await page.mouse.move(endX, box.y + box.height / 2, { steps: 18 });
  await page.mouse.up();
  await wait(settle);
};

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('[data-testid="book-row-4"], [data-testid="book-row-5"], [data-testid="book-row-6"]', {
    timeout: 90000,
  });
  await wait(2400);

  await move(360, 240);
  await click(page.locator('[data-testid="book-row-5"]'), 1200);
  await page.mouse.wheel(0, 180);
  await wait(1400);
  await page.mouse.wheel(0, -180);
  await slide(page.locator('[data-testid="leg-size"]'), 14, 900);
  await wait(900);

  await click(page.locator('[data-testid="tab-model"]'), 1400);
  await slide(page.locator('[data-testid="slider-observed"]'), 4200, 700);
  await slide(page.locator('[data-testid="slider-strike"]'), 5000, 700);
  await slide(page.locator('[data-testid="slider-corridor"]'), 2500, 700);
  await slide(page.locator('[data-testid="basket-units"]'), 52, 800);
  await wait(1100);

  await click(page.locator('[data-testid="tab-telemetry"]'), 1400);
  await wait(1200);
  await click(page.locator('[data-testid="telemetry-open"]'), 2600);
  await wait(1500);
  await page.mouse.wheel(0, 320);
  await wait(1300);
  await page.mouse.wheel(0, 340);
  await wait(1300);
  await page.mouse.wheel(0, 340);
  await wait(1200);
  await click(page.locator('[data-testid="telemetry-close"]'), 900);

  await click(page.locator('[data-testid="desk-button"]'), 1600);
  await slide(page.locator('[data-testid="deposit-units"]'), 34, 700);
  await click(page.locator('[data-testid="desk-slot-1"]'), 1500);
  await click(page.locator('[data-testid="desk-slot-0"]'), 1500);
  await page.mouse.wheel(0, 220);
  await wait(1200);
  await click(page.locator('[data-testid="desk-close"]'), 900);

  await click(page.locator('[data-testid="tab-books"]'), 1500);
  await page.mouse.wheel(0, 700);
  await wait(1600);
  await page.mouse.wheel(0, -700);
  await wait(1800);
} catch (error) {
  problems.push(`flow: ${error.message.slice(0, 200)}`);
} finally {
  await page.close().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

const video = page.video();
let source = null;
try {
  source = video ? await video.path() : null;
} catch {
  source = null;
}

const { renameSync, existsSync } = await import("node:fs");
if (source && existsSync(source)) {
  renameSync(source, outPath);
} else {
  const dir = join(root, ".build", "video-raw");
  const { readdirSync, statSync } = await import("node:fs");
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".webm"))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  if (candidates.length === 0) {
    console.log(JSON.stringify({ ok: false, problems, out: null }));
    process.exit(1);
  }
  renameSync(join(dir, candidates[0].name), outPath);
}

console.log(JSON.stringify({ ok: problems.length === 0, problems: problems.slice(0, 6), out: outPath }, null, 2));
