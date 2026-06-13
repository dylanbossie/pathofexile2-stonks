import type { HistoryPoint } from "./api";
import { buildMarketIndex, type ItemSeries } from "./invest";

const DAY_MS = 86_400_000;

/** Whole days from `startMs` to the given ISO date (league-relative day index). */
function dayIndex(dateIso: string, startMs: number): number {
  return Math.round((Date.parse(dateIso) - startMs) / DAY_MS);
}

/** Earliest history date across a set of series, in ms — a league-start proxy. */
export function leagueStartMs(series: ItemSeries[]): number | null {
  let min = Infinity;
  for (const s of series) {
    for (const h of s.history) min = Math.min(min, Date.parse(h.date));
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * Forward-filled price levels indexed by league-relative day. `out[d]` is the
 * price on day `d` (days since `startMs`); gaps carry the last known price,
 * and days before the first listing stay null.
 */
function dayLevels(
  history: { date: string; rate: number }[],
  startMs: number,
): (number | null)[] {
  if (history.length === 0) return [];
  const lastDay = dayIndex(history[history.length - 1].date, startMs);
  if (lastDay < 0) return [];
  const out = new Array<number | null>(lastDay + 1).fill(null);
  for (const h of history) {
    const d = dayIndex(h.date, startMs);
    if (d >= 0 && d < out.length) out[d] = h.rate;
  }
  let last: number | null = null;
  for (let d = 0; d < out.length; d++) {
    if (out[d] === null) out[d] = last;
    else last = out[d];
  }
  return out;
}

/**
 * Prior-league market daily returns indexed by league-relative day (days with
 * no data are 0). Drives the beta projection one day at a time, which avoids
 * the blow-up of compounding a whole league's inflation in one exponent.
 */
export function priorMarketReturns(
  priorSeries: ItemSeries[],
  priorStartMs: number,
): number[] {
  const returns = buildMarketIndex(priorSeries);
  let maxDay = -1;
  const byDay = new Map<number, number>();
  for (const [date, ret] of returns) {
    const d = dayIndex(date, priorStartMs);
    if (d >= 0) {
      byDay.set(d, ret);
      maxDay = Math.max(maxDay, d);
    }
  }
  const out = new Array<number>(maxDay + 1).fill(0);
  for (const [d, ret] of byDay) out[d] = ret;
  return out;
}

/** A point on a price line, located by league-relative day. */
export interface ProjectedPoint {
  day: number;
  price: number;
}

/** A price history as {day-in-league, price} points (drops pre-start/zero). */
export function toDayPoints(
  history: HistoryPoint[],
  startMs: number,
): ProjectedPoint[] {
  return history
    .map((h) => ({ day: dayIndex(h.date, startMs), price: h.rate }))
    .filter((p) => p.day >= 0 && p.price > 0);
}

export interface ItemProjection {
  /** The current day-in-league we're projecting from (today's day index). */
  currentDay: number;
  /** Current-league actual price up to today, by day-in-league. */
  actual: ProjectedPoint[];
  /** Forward path tracing the item's own prior-league trajectory from today. */
  priorPath: ProjectedPoint[];
  /** Forward path from current beta × prior-league market inflation. */
  betaPath: ProjectedPoint[];
}

export interface ProjectionContext {
  currentStartMs: number;
  priorStartMs: number;
  /** Prior-league market daily returns by day (from priorMarketReturns). */
  priorMarketRet: number[];
}

/**
 * Projects an item's price forward from today, aligned by day-in-league:
 *
 *  - priorPath anchors at today's price and follows the item's own prior-league
 *    relative moves from the same day-in-league onward (raw, full strength).
 *  - betaPath anchors at today's price and grows with the prior league's market
 *    inflation raised to the item's current beta — what its sensitivity alone
 *    would imply under the same conditions.
 *
 * Both lines start at today's actual price so the charts are directly
 * comparable. Returns null if there isn't enough aligned history to anchor.
 */
export function projectItem(
  currentHistory: HistoryPoint[],
  priorHistory: HistoryPoint[],
  beta: number,
  horizonDays: number,
  ctx: ProjectionContext,
): ItemProjection | null {
  const curLevels = dayLevels(currentHistory, ctx.currentStartMs);
  const currentDay = curLevels.length - 1;
  const anchor = currentDay >= 0 ? curLevels[currentDay] : null;
  if (anchor == null) return null;

  const actual: ProjectedPoint[] = [];
  for (let d = 0; d <= currentDay; d++) {
    const price = curLevels[d];
    if (price != null) actual.push({ day: d, price });
  }

  const priorLevels = dayLevels(priorHistory, ctx.priorStartMs);
  const priorAtToday = priorLevels[currentDay] ?? null;

  const priorPath: ProjectedPoint[] = [{ day: currentDay, price: anchor }];
  const betaPath: ProjectedPoint[] = [{ day: currentDay, price: anchor }];
  // betaPath compounds the market's daily return scaled by beta, one day at a
  // time, starting from today's price.
  let betaMult = 1;
  for (let j = 1; j <= horizonDays; j++) {
    const day = currentDay + j;
    const priorLevel = priorLevels[day];
    if (priorAtToday != null && priorAtToday > 0 && priorLevel != null) {
      priorPath.push({ day, price: anchor * (priorLevel / priorAtToday) });
    }
    if (day < ctx.priorMarketRet.length) {
      betaMult *= 1 + beta * ctx.priorMarketRet[day];
      if (betaMult > 0) betaPath.push({ day, price: anchor * betaMult });
    }
  }

  return { currentDay, actual, priorPath, betaPath };
}
