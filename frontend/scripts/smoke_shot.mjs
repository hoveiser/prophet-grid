/** Quick UI smoke test: load the built app and capture a screenshot. */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173/prophet-grid/";
mkdirSync(join(root, "artifacts"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text().slice(0, 300));
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector('[data-testid="market-card-1"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const cards = await page.locator('[data-testid^="market-card-"]').count();
  const stats = await page.locator('[data-testid="invariant-badge"]').textContent();
  await page.screenshot({ path: join(root, "artifacts", "ui-dashboard.png"), fullPage: false });
  await page.locator('[data-testid="market-card-4"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="tab-whatif"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(root, "artifacts", "ui-simulator.png"), fullPage: false });
  await page.locator('[data-testid="tab-guards"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(root, "artifacts", "ui-guards.png"), fullPage: false });
  console.log(JSON.stringify({ cards, invariant: stats, errors }, null, 2));
} catch (error) {
  console.log("smoke failed:", error instanceof Error ? error.message : String(error));
  console.log(JSON.stringify({ errors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
