import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:5174";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });

const log = (...a) => console.log(...a);

await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

// Go to Stonks tab.
await page.getByRole("button", { name: "Stonks" }).click();
await page.waitForTimeout(500);

// The portfolio add search should be present and enabled once economy loads.
const search = page.getByPlaceholder("Search an item you bought…");
await search.waitFor({ timeout: 30000 });

// Type a query and pick the first suggestion.
await search.click();
await search.fill("orb");
await page.waitForTimeout(400);
const firstSuggestion = page.locator(".portfolio .suggestions li").first();
await firstSuggestion.waitFor({ timeout: 5000 });
const pickedName = (await firstSuggestion.locator("span").first().innerText()).trim();
await firstSuggestion.click();
log("picked:", pickedName);

// Set quantity and buy price, then add.
await page.getByRole("spinbutton", { name: "Quantity" }).fill("3");
await page.getByRole("spinbutton", { name: "Buy price (div)" }).fill("1.5");
await page.locator(".portfolio-add").getByRole("button", { name: "Add" }).click();
await page.waitForTimeout(400);

const rowsBefore = await page.locator(".holdings tbody tr").count();
log("holdings rows after add:", rowsBefore);
const totals = await page.locator(".portfolio-totals").innerText();
log("totals:", totals.replace(/\s+/g, " "));

await page.screenshot({ path: "scripts/app-portfolio.png", fullPage: true });

// Reload and confirm persistence.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Stonks" }).click();
await page.waitForTimeout(800);
const rowsAfter = await page.locator(".holdings tbody tr").count();
log("holdings rows after reload:", rowsAfter);
const persistedName = await page.locator(".holdings .holding-name").first().innerText();
log("persisted holding:", persistedName.replace(/\s+/g, " "));

await browser.close();
log(
  rowsAfter >= 1 && rowsBefore >= 1
    ? "PASS: holding added and persisted across reload"
    : "FAIL: holding did not persist",
);
