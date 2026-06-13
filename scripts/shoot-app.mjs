import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:5174";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });

await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500); // let fonts + first economy fetch settle
await page.screenshot({ path: "scripts/app-calculator.png" });

// Switch to the Stonks tab and run the analysis.
await page.getByRole("button", { name: "Stonks" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "scripts/app-stonks-empty.png" });

await page.getByRole("button", { name: /investment opportunities/i }).click();
// Wait for results (or give up after a while).
await page
  .locator(".opportunities li, .results .muted")
  .first()
  .waitFor({ timeout: 45000 })
  .catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: "scripts/app-stonks.png", fullPage: true });

await browser.close();
console.log("screenshots written");
