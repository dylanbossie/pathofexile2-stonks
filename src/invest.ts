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
  /**
   * The same item's prior-league price history, when available. Attached for
   * the per-item expander/projection only — it does not affect the beta, R²,
   * or any other current-league figure on the row.
   */
  priorHistory: HistoryPoint[] | null;
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
/** Default R²: require genuine market tracking, not noise, before ranking. */
export const DEFAULT_MIN_R_SQUARED = 0.25;

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
export function buildMarketIndex(series: ItemSeries[]): Map<string, number> {
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

/** A single (market return, item return) observation on one date. */
interface ReturnPair {
  /** Market index return that day. */
  x: number;
  /** Item return that day. */
  y: number;
}

/** Aligns an item's daily returns to a market index, yielding paired returns. */
function returnPairs(
  itemReturns: Map<string, number>,
  market: Map<string, number>,
): ReturnPair[] {
  const pairs: ReturnPair[] = [];
  for (const [date, ret] of itemReturns) {
    const m = market.get(date);
    if (m !== undefined) pairs.push({ x: m, y: ret });
  }
  return pairs;
}

/**
 * OLS regression of item returns on market returns over the pooled pairs,
 * giving the CAPM beta (slope) and R² (fit). Pairs may come from more than
 * one league — each aligned to its own market index before pooling — on the
 * assumption that an item's sensitivity to inflation carries across leagues.
 */
function regressPairs(
  pairs: ReturnPair[],
): { beta: number; rSquared: number; points: number } | null {
  const n = pairs.length;
  if (n < MIN_RETURN_PAIRS) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of pairs) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;

  return { beta: cov / varX, rSquared: (cov * cov) / (varX * varY), points: n };
}

/** Cross-league identity: the same item slug within the same category. */
function identityKey(item: PricedItem): string {
  return `${item.type}:${item.detailsId}`;
}

export interface RankOptions {
  minRSquared?: number;
  /** Minimum current unit price in divines (0 = no minimum). */
  minPrice?: number;
  /** Maximum current unit price in divines (Infinity = no maximum). */
  maxPrice?: number;
  /**
   * Histories from a prior (typically ended) league. Used only to attach each
   * item's prior-league history to its opportunity (for the expander and
   * forward projection) — it does NOT influence the beta, R², or any other
   * current-league figure. Matched by cross-league identity.
   */
  priorSeries?: ItemSeries[];
}

/**
 * Ranks items by their inflation beta — sensitivity to the market index —
 * keeping only those that track the market reliably (R² ≥ threshold), sit
 * in the price window, and have enough history. Beta > 1 means the item
 * amplifies inflation; under a positive market drift these are the items
 * expected to rise the most. Returns all matches, sorted by beta.
 *
 * The market index is built from the full liquid basket regardless of the
 * price window — the window narrows which opportunities you see, not what
 * counts as "the economy".
 */
export function rankOpportunities(
  series: ItemSeries[],
  options: RankOptions = {},
): InvestmentReport {
  const {
    minRSquared = DEFAULT_MIN_R_SQUARED,
    minPrice = 0,
    maxPrice = Infinity,
    priorSeries,
  } = options;

  const usable = series.filter((s) => s.history.length >= MIN_POINTS);
  const market = buildMarketIndex(usable);

  // Index the prior league by cross-league identity, so we can attach each
  // item's prior history for the expander (not for the regression).
  const priorByIdentity = new Map<string, ItemSeries>();
  for (const s of priorSeries ?? []) priorByIdentity.set(identityKey(s.item), s);

  const opportunities: Opportunity[] = [];
  for (const s of usable) {
    const price = s.item.unitDivines;
    if (price < minPrice || price > maxPrice) continue;

    const reg = regressPairs(returnPairs(dailyReturns(s.history), market));
    if (!reg || reg.rSquared < minRSquared) continue;
    const h = s.history;
    const realizedChange =
      h[0].rate > 0 ? h[h.length - 1].rate / h[0].rate - 1 : 0;
    const prior = priorByIdentity.get(identityKey(s.item));
    opportunities.push({
      item: s.item,
      beta: reg.beta,
      rSquared: reg.rSquared,
      realizedChange,
      points: reg.points,
      history: h,
      priorHistory: prior && prior.history.length > 0 ? prior.history : null,
    });
  }
  opportunities.sort((a, b) => b.beta - a.beta);

  return {
    marketDrift: marketDrift(market),
    windowDays: market.size,
    opportunities,
  };
}
