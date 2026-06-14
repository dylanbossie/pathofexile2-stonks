import { useEffect, useState } from "react";
import {
  fetchItemHistory,
  mapLimit,
  PRIOR_LEAGUE,
  type HistoryPoint,
  type MergedEconomy,
  type PricedItem,
} from "./api";
import type { Position } from "./portfolioStore";

/** Concurrent detail requests; matches the analyzer's politeness budget. */
const FETCH_CONCURRENCY = 8;

export interface HoldingHistory {
  /** Current-league daily price history (empty if unavailable). */
  current: HistoryPoint[];
  /** Prior-league (Fate of the Vaal) history, when the item existed then. */
  prior: HistoryPoint[] | null;
}

export interface PortfolioHistories {
  byKey: Map<string, HoldingHistory>;
  loading: boolean;
}

/**
 * Fetches current-league (and prior-league) daily price history for each
 * holding, resolving the item's API type/detailsId from the current economy.
 * These histories drive the portfolio value chart, the per-row sparklines, and
 * the per-holding Fate of the Vaal expander. Only the *set* of held items
 * triggers a refetch — quantity and buy-price edits reuse the cached series.
 */
export function usePortfolioHistories(
  league: string,
  positions: Position[],
  economy: MergedEconomy | null,
  priorEconomy: MergedEconomy | null,
): PortfolioHistories {
  const [byKey, setByKey] = useState<Map<string, HoldingHistory>>(new Map());
  const [loading, setLoading] = useState(false);

  // A stable signature of the held items, so edits that don't change the set
  // (quantity, buy price) don't re-trigger the fetch.
  const sig = positions
    .map((p) => p.key)
    .sort()
    .join(",");

  useEffect(() => {
    if (!league || !economy || positions.length === 0) {
      setByKey(new Map());
      return;
    }

    // Resolve each holding to its API identity (type + slug) via the current
    // economy; holdings no longer listed can't be fetched and are skipped.
    const metaByKey = new Map(economy.items.map((it) => [it.key, it]));
    const targets = positions
      .map((p) => metaByKey.get(p.key))
      .filter((it): it is PricedItem => Boolean(it && it.detailsId));

    if (targets.length === 0) {
      setByKey(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchFor = (forLeague: string, items: PricedItem[]) =>
      mapLimit(items, FETCH_CONCURRENCY, async (it) => {
        try {
          const history = await fetchItemHistory(
            forLeague,
            it.type,
            it.detailsId,
          );
          return { key: it.key, history };
        } catch {
          return { key: it.key, history: [] as HistoryPoint[] };
        }
      });

    (async () => {
      const current = await fetchFor(league, targets);

      // Prior-league histories for holdings that existed then, matched by
      // cross-league identity (same type + slug), using the tab-wide
      // prefetched prior economy. Until it lands, holdings get no FotV panel;
      // adding it to the effect deps refetches these once it does.
      const prior = new Map<string, HistoryPoint[]>();
      if (priorEconomy) {
        try {
          const priorByIdentity = new Map<string, PricedItem>();
          for (const it of priorEconomy.items) {
            if (it.detailsId) {
              priorByIdentity.set(`${it.type}:${it.detailsId}`, it);
            }
          }
          const priorTargets = targets
            .map((it) => priorByIdentity.get(`${it.type}:${it.detailsId}`))
            .filter((it): it is PricedItem => Boolean(it));
          const byPriorKey = new Map(priorTargets.map((it) => [it.key, it]));
          const priorHist = await fetchFor(PRIOR_LEAGUE, priorTargets);
          // Re-key prior results back onto the current-economy key.
          const currentByIdentity = new Map(
            targets.map((it) => [`${it.type}:${it.detailsId}`, it.key]),
          );
          for (const r of priorHist) {
            const priorItem = byPriorKey.get(r.key);
            if (!priorItem) continue;
            const curKey = currentByIdentity.get(
              `${priorItem.type}:${priorItem.detailsId}`,
            );
            if (curKey) prior.set(curKey, r.history);
          }
        } catch {
          // Prior history unavailable; holdings simply won't get a FotV panel.
        }
      }

      if (cancelled) return;
      const next = new Map<string, HoldingHistory>();
      for (const c of current) {
        const p = prior.get(c.key);
        next.set(c.key, {
          current: c.history,
          prior: p && p.length > 0 ? p : null,
        });
      }
      setByKey(next);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // `sig` stands in for `positions`; economy identity changes on refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, sig, economy, priorEconomy]);

  return { byKey, loading };
}

/** One point on the aggregate portfolio-value line. */
export interface ValuePoint {
  date: string;
  /** Total market value (Σ quantity × price) of priced holdings that day. */
  value: number;
}

/**
 * Builds the portfolio's total-value-over-time series from each holding's
 * quantity and current-league history. Prices are forward-filled across the
 * union of all dates, so a holding with a stale last price still contributes
 * its most recent value. Days before any holding has a price are dropped.
 */
export function portfolioValueSeries(
  holdings: { quantity: number; history: HistoryPoint[] }[],
): ValuePoint[] {
  const dates = new Set<string>();
  for (const h of holdings) {
    for (const p of h.history) dates.add(p.date);
  }
  const axis = [...dates].sort((a, b) => a.localeCompare(b));
  if (axis.length < 2) return [];

  const cursor = holdings.map(() => 0);
  const last = holdings.map<number | null>(() => null);
  const out: ValuePoint[] = [];

  for (const date of axis) {
    let value = 0;
    let priced = false;
    holdings.forEach((h, i) => {
      while (cursor[i] < h.history.length && h.history[cursor[i]].date <= date) {
        last[i] = h.history[cursor[i]].rate;
        cursor[i] += 1;
      }
      if (last[i] !== null) {
        value += h.quantity * (last[i] as number);
        priced = true;
      }
    });
    if (priced) out.push({ date, value });
  }
  return out;
}
