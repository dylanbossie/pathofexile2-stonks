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

## Caching

Every poe.ninja response is cached in `localStorage` for 15 minutes, so
the API is queried at most once per league/category per 15-minute window,
even across page reloads. The header shows how old the prices are.
