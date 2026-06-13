# PoE2 Stonks

Checks current PoE2 currency values from poe.ninja and tells you what to
sell for, always rounding **down** when pricing in divines.

## Run

```sh
npm install
npm run dev
```

poe.ninja does not send CORS headers, so all API calls go through the Vite
dev-server proxy (`/ninja/*` → `https://poe.ninja/*`, see `vite.config.ts`).
A production deployment would need an equivalent reverse proxy.

## How values are computed

The exchange overview endpoint prices every item in divines
(`lines[].primaryValue`) and reports the exalt rate per divine
(`core.rates.exalted`). All 14 exchange categories (Currency, Runes,
Essences, …) are fetched and merged into one dropdown.

- exalt/divine ratio = `core.rates.exalted`
- sale price in exalts = `floor(amount × primaryValue × ratio)`
- sale price in divines = `floor(amount × primaryValue)` — the fraction
  is forfeited entirely, never topped up with exalts
- the recommended denomination is whichever post-rounding price is worth
  more (divine price compared via `sellDivines × ratio`)

## Stonks tab

The **Stonks** tab finds items "expected to rise most with inflation" by
ranking on **inflation beta** rather than raw recent gain (which just
surfaces spikes you've already missed):

1. Filter to liquid items (≥ 500 divines volume, `volumePrimaryValue`).
2. Pull each item's full daily divine-price history from the per-item
   details endpoint (`exchange/current/details?...&id=<detailsId>`).
3. Build a volume-weighted **market index** of daily returns — this
   trajectory is the measured inflation of the divine-denominated basket.
4. Regress each item's daily returns on the market's to get its **beta**
   (sensitivity: >1 amplifies inflation) and **R²** (how reliably it
   tracks the market).
5. Rank by beta, keeping only items with R² ≥ 0.25 and enough history.

Each pick shows its beta, R², realized change, and a sparkline of its
actual divine-price history. The header reports the market drift over the
window so you can see the inflation regime. See `src/invest.ts` for the
math and `src/Stonks.tsx` for the orchestration.

Note: beta finds inflation-*sensitive* assets from past prices; it can't
predict patch/meta shifts, which aren't in the data.

## Caching

Every poe.ninja response is cached in `localStorage` for 15 minutes, so
the API is queried at most once per league/category per 15-minute window,
even across page reloads. The header shows how old the prices are.
