import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("https://pathofexile2.com/home", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(2000);

await page.screenshot({ path: "scripts/poe2-home.png", fullPage: false });
await page.screenshot({ path: "scripts/poe2-home-full.png", fullPage: true });

// Pull design tokens: body/background, fonts, headings, buttons, links.
const tokens = await page.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (s, keys) =>
    s ? Object.fromEntries(keys.map((k) => [k, s.getPropertyValue(k)])) : null;

  const body = cs(document.body);
  const h1 = cs(document.querySelector("h1, h2, .title, header"));
  const btn = cs(
    document.querySelector(
      "button, a.button, .btn, [class*='button'], [class*='btn']",
    ),
  );
  const link = cs(document.querySelector("nav a, a"));

  // Sample fill colors from many elements to find the palette.
  const colorCounts = {};
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    for (const prop of ["color", "background-color", "border-top-color"]) {
      const v = s.getPropertyValue(prop);
      if (v && v !== "rgba(0, 0, 0, 0)" && v !== "rgb(0, 0, 0)") {
        colorCounts[v] = (colorCounts[v] || 0) + 1;
      }
    }
  }
  const topColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const fonts = new Set();
  for (const el of document.querySelectorAll("body, h1, h2, h3, p, a, button, nav")) {
    fonts.add(getComputedStyle(el).getPropertyValue("font-family"));
  }

  return {
    body: pick(body, [
      "background-color",
      "color",
      "font-family",
      "font-size",
    ]),
    bodyBackgroundImage: body?.getPropertyValue("background-image"),
    heading: pick(h1, [
      "color",
      "font-family",
      "font-size",
      "font-weight",
      "letter-spacing",
      "text-transform",
    ]),
    button: pick(btn, [
      "background-color",
      "color",
      "border",
      "border-radius",
      "font-family",
      "text-transform",
      "letter-spacing",
      "padding",
    ]),
    link: pick(link, ["color", "font-family"]),
    fonts: [...fonts],
    topColors,
  };
});

console.log(JSON.stringify(tokens, null, 2));
await browser.close();
