import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 1200 } });
await page.goto("http://localhost:5174", { waitUntil: "load", timeout: 60000 });
await page.getByRole("button", { name: "Stonks" }).click();
const genBtn = page.getByRole("button", { name: /investment opportunities/i });
await genBtn.waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /investment opportunities/i.test(x.textContent || ""));
  return b && !b.disabled;
}, { timeout: 90000 });
await page.getByRole("spinbutton", { name: /Min volume/ }).fill("400");
await page.getByRole("slider", { name: /Min R/ }).fill("0");
await page.getByRole("checkbox", { name: /previous league/i }).check();
await genBtn.click();
await page.locator(".opp-expander").first().waitFor({ timeout: 120000 });

let row = page.locator(".opportunities li", { hasText: "Tul" }).first();
if ((await row.count()) === 0 || (await row.locator(".opp-expander").count()) === 0) {
  row = page.locator(".opportunities li", { has: page.locator(".opp-expander") }).first();
}
const name = (await row.locator(".opp-name").innerText()).split("·")[0].trim();
await row.locator(".opp-expander").click();
await page.waitForTimeout(300);

const toggle = row.getByRole("checkbox", { name: /Overlay current/i });
console.log("expanded:", name, "| overlay checkbox present:", await toggle.count());
await toggle.check();
await page.waitForTimeout(300);
// Two polylines on the prior chart = FotV + current overlay.
const lines = await row.locator(".prior-chart").first().locator("svg polyline").count();
console.log("prior chart polylines after overlay:", lines);
await row.locator(".opp-detail").screenshot({ path: "scripts/app-overlay.png" });
await browser.close();
console.log(lines >= 2 ? "PASS: current-league overlay drawn" : "FAIL: overlay missing");
