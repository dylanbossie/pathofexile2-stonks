import type { HistoryPoint, PricedItem } from "./api";

export interface ItemSeries {
  item: PricedItem;
  history: HistoryPoint[];
}

export interface Opportunity {
  item: PricedItem;
  /** Sensitivity to the market index: >1 amplifies inflation. */
  beta: number;
  /** Share of the item's movement explained by the market (0–1). */
  rSquared: number;
  /** Realized divine-price change over the available window (fraction). */
  realizedChange: number;
  /** Number of daily returns used in the regression. */
  points: number;
  history: HistoryPoint[];
}

export interface InvestmentReport {
  /** Compounded market drift over the window (fraction). */
  marketDrift: number;
  /** Number of dates in the market index. */
  windowDays: number;
  opportunities: Opportunity[];
}

/** Minimum history points (≈ daily snapshots) for an item to be considered. */
const MIN_POINTS = 6;
/** Minimum overlap with the market index needed for a stable regression. */
const MIN_RETURN_PAIRS = 5;
/** Require genuine market tracking, not noise, before ranking on beta. */
const MIN_R_SQUARED = 0.25;

/** Daily simple returns keyed by the later date of each pair. */
function dailyReturns(history: HistoryPoint[]): Map<string, number> {
  const returns = new Map<string, number>();
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].rate;
    const cur = history[i].rate;
    if (prev > 0) returns.set(history[i].date, cur / prev - 1);
  }
  return returns;
}

/**
 * Volume-weighted average daily return across all items, per date. This
 * trajectory is the measured "inflation" of the divine-denominated basket.
 */
function buildMarketIndex(series: ItemSeries[]): Map<string, number> {
  const acc = new Map<string, { num: number; den: number }>();
  for (const s of series) {
    const weight = s.item.volumeDivines;
    for (const [date, ret] of dailyReturns(s.history)) {
      const a = acc.get(date) ?? { num: 0, den: 0 };
      a.num += ret * weight;
      a.den += weight;
      acc.set(date, a);
    }
  }
  const market = new Map<string, number>();
  for (const [date, a] of acc) {
    if (a.den > 0) market.set(date, a.num / a.den);
  }
  return market;
}

/** Compounded drift of the market index over the whole window. */
function marketDrift(market: Map<string, number>): number {
  let cumulative = 1;
  for (const ret of market.values()) cumulative *= 1 + ret;
  return cumulative - 1;
}

/**
 * Regress an item's daily returns on the market's, over shared dates.
 * Returns the CAPM beta and R² (how reliably it tracks the market).
 */
function regress(
  itemReturns: Map<string, number>,
  market: Map<string, number>,
): { beta: number; rSquared: number; points: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, ret] of itemReturns) {
    const m = market.get(date);
    if (m !== undefined) {
      xs.push(m);
      ys.push(ret);
    }
  }
  const n = xs.length;
  if (n < MIN_RETURN_PAIRS) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) ** 2;
    varY += (ys[i] - meanY) ** 2;
  }
  if (varX === 0 || varY === 0) return null;

  return { beta: cov / varX, rSquared: (cov * cov) / (varX * varY), points: n };
}

/**
 * Ranks items by their inflation beta — sensitivity to the market index —
 * keeping only those that track the market reliably (R² ≥ threshold) and
 * have enough history. Beta > 1 means the item amplifies inflation; under a
 * positive market drift these are the items expected to rise the most.
 */
export function rankOpportunities(
  series: ItemSeries[],
  topN: number,
): InvestmentReport {
  const usable = series.filter((s) => s.history.length >= MIN_POINTS);
  const market = buildMarketIndex(usable);

  const opportunities: Opportunity[] = [];
  for (const s of usable) {
    const reg = regress(dailyReturns(s.history), market);
    if (!reg || reg.rSquared < MIN_R_SQUARED) continue;
    const h = s.history;
    const realizedChange =
      h[0].rate > 0 ? h[h.length - 1].rate / h[0].rate - 1 : 0;
    opportunities.push({
      item: s.item,
      beta: reg.beta,
      rSquared: reg.rSquared,
      realizedChange,
      points: reg.points,
      history: h,
    });
  }
  opportunities.sort((a, b) => b.beta - a.beta);

  return {
    marketDrift: marketDrift(market),
    windowDays: market.size,
    opportunities: opportunities.slice(0, topN),
  };
}
