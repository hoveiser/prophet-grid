/**
 * Record the live ProphetGrid UI flow with Playwright.
 *
 * The burner slot 0 is loaded with the deterministic demo key derived from
 * GENLAYER_PRIVATE_KEY (the same derivation the seeding script uses), so the
 * recording can exercise real trades and real guard reverts. The key never
 * appears in the UI, only the derived address does.
 *
 * Usage: node scripts/record_demo.mjs [baseUrl]
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { keccak256, toHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173/prophet-grid/";
const rawDir = join(root, "artifacts", "video-raw");
mkdirSync(rawDir, { recursive: true });

const envText = readFileSync(join(root, ".env"), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}
const master = env.GENLAYER_PRIVATE_KEY;
if (!master) throw new Error("GENLAYER_PRIVATE_KEY is missing from .env");
const demoKey = keccak256(toHex(`prophet-grid-burner-v1:1:${master.toLowerCase()}`));

const beat = (ms) => new Promise((done) => setTimeout(done, ms));

async function smoothClick(page, locator) {
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
    await beat(180);
  }
  await locator.click();
  await beat(320);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
  reducedMotion: "no-preference",
});
await context.addInitScript((key) => {
  window.localStorage.setItem("pg.burner.0.key", key);
}, demoKey);

const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.log("page error:", message.text().slice(0, 200));
});

try {
  console.log("loading", baseUrl);
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector('[data-testid="market-card-1"]', { timeout: 90000 });
  await beat(2600);

  await page.hover('[data-testid="invariant-badge"]');
  await beat(900);

  // Settled market with the validator receipt drawer.
  await smoothClick(page, page.locator('[data-testid="market-card-1"]'));
  await beat(1600);
  await smoothClick(page, page.getByRole("button", { name: /consensus receipt/ }));
  await page.waitForSelector('[data-testid="consensus-drawer"]', { timeout: 30000 });
  await beat(2200);
  await smoothClick(page, page.locator('[data-testid="consensus-drawer"] button[aria-label="Close"]'));
  await beat(900);

  // Live challenge window market.
  await smoothClick(page, page.locator('[data-testid="market-card-4"]'));
  await beat(2200);
  await page.hover('input[aria-label="counter evidence url"]');
  await beat(900);

  // What-If simulator.
  await smoothClick(page, page.locator('[data-testid="tab-whatif"]'));
  await beat(1400);
  const stake = page.locator('input[aria-label="your stake"]');
  await stake.click({ position: { x: 150, y: 2 } });
  await beat(800);
  await stake.click({ position: { x: 40, y: 2 } });
  await beat(800);
  await stake.click({ position: { x: 230, y: 2 } });
  await beat(1200);
  await page.mouse.wheel(0, 360);
  await beat(2200);

  // Security guard lab: dry run then one live revert.
  await smoothClick(page, page.locator('[data-testid="tab-guards"]'));
  await beat(1400);
  await smoothClick(page, page.locator('[data-testid="guard-premature"] button:has-text("Dry run")'));
  await beat(1600);
  await smoothClick(page, page.locator('[data-testid="guard-live-premature"]'));
  await page.waitForSelector('[data-testid="guard-result-premature"]', { timeout: 150000 });
  await page.getByText("REVERT CONFIRMED").first().waitFor({ timeout: 30000 });
  await beat(2200);

  // Wallet: mint collateral on the demo identity.
  await smoothClick(page, page.locator('[data-testid="tab-wallet"]'));
  await beat(1200);
  await smoothClick(page, page.locator('[data-testid="mint-button"]'));
  await page.getByText("1000 PGT minted").first().waitFor({ timeout: 150000 });
  await beat(1800);

  // Switch identity to a fresh burner and back.
  await smoothClick(page, page.getByRole("button", { name: /Burner Bravo/ }));
  await beat(1500);
  await smoothClick(page, page.getByRole("button", { name: /Burner Alpha/ }));
  await beat(1500);

  // Trade on the open market.
  await smoothClick(page, page.locator('[data-testid="tab-market"]'));
  await beat(900);
  await smoothClick(page, page.locator('[data-testid="market-card-5"]'));
  await beat(1400);
  await page.fill('input[aria-label="trade amount"]', "50");
  await beat(600);
  await smoothClick(page, page.getByRole("button", { name: /^Buy YES$/ }));
  await page.getByText("buy_outcome_shares confirmed").first().waitFor({ timeout: 150000 });
  await beat(2000);

  // Closing shot on the simulator and the hero.
  await smoothClick(page, page.locator('[data-testid="tab-whatif"]'));
  await beat(1200);
  await page.mouse.wheel(0, 320);
  await beat(1400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(2400);
} catch (error) {
  console.log("recording step failed:", error instanceof Error ? error.message : String(error));
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const source = await video.path();
    const target = join(root, "artifacts", "demo-raw.webm");
    try {
      renameSync(source, target);
      console.log("raw video:", target, `${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      const files = readdirSync(rawDir).filter((name) => name.endsWith(".webm"));
      console.log("raw video kept in", rawDir, files.join(", "));
    }
  }
}
