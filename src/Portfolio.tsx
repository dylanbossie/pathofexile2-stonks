import { Fragment, useMemo, useState } from "react";
import { PRIOR_LEAGUE, type MergedEconomy, type PricedItem } from "./api";
import { formatNumber } from "./format";
import ItemSearch from "./ItemSearch";
import PortfolioChart from "./PortfolioChart";
import PriorDetail from "./PriorDetail";
import Sparkline from "./Sparkline";
import { portfolioValueSeries, usePortfolioHistories } from "./portfolioHistory";
import {
  valuePortfolio,
  type Portfolio as PortfolioApi,
} from "./portfolioStore";
import type { ProjectionContext } from "./projection";

/** Days forward the per-holding Fate of the Vaal projection extends. */
const PROJECTION_HORIZON_DAYS = 30;

/** Earliest history date (ms) across a set of holding histories, or null. */
function earliestDate(histories: { date: string }[][]): number | null {
  let min = Infinity;
  for (const h of histories) {
    for (const p of h) min = Math.min(min, Date.parse(p.date));
  }
  return Number.isFinite(min) ? min : null;
}

/** Parse a user-typed number, returning `fallback` for blank/invalid input. */
function parseNum(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Renders signed divines, e.g. "+1.5 div" / "−0.3 div". */
function signedDiv(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatNumber(Math.abs(n), 2)} div`;
}

export default function Portfolio({
  economy,
  priorEconomy,
  league,
  loading,
  portfolio,
  projectionCtx,
  betaByKey,
}: {
  economy: MergedEconomy | null;
  /** Prior (ended) league economy, prefetched in App and shared tab-wide. */
  priorEconomy: MergedEconomy | null;
  league: string;
  loading: boolean;
  portfolio: PortfolioApi;
  /**
   * Projection context from the analyzer (broad-basket league-start days and
   * prior-league market returns), when it has been run with prior history.
   * Enables the β × market projection line; absent, only the item's own prior
   * path is projected.
   */
  projectionCtx: ProjectionContext | null;
  /** Per-item inflation beta from the latest analysis, by item key. */
  betaByKey: Map<string, number>;
}) {
  const { positions, addPosition, updatePosition, removePosition } = portfolio;

  const [selected, setSelected] = useState<PricedItem | null>(null);
  const [qty, setQty] = useState("1");
  const [buy, setBuy] = useState("");
  // Bumped after each add to remount (and so clear) the search box.
  const [searchKey, setSearchKey] = useState(0);
  // Which holdings have their Fate of the Vaal panel expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { byKey: histories, loading: historyLoading } = usePortfolioHistories(
    league,
    positions,
    economy,
    priorEconomy,
  );

  const valuation = useMemo(
    () => valuePortfolio(positions, economy),
    [positions, economy],
  );

  // Aggregate value-over-time across every holding that has a price history.
  const valueSeries = useMemo(
    () =>
      portfolioValueSeries(
        positions.map((p) => ({
          quantity: p.quantity,
          history: histories.get(p.key)?.current ?? [],
        })),
      ),
    [positions, histories],
  );

  // League-start days for projections: reuse the analyzer's when present (so
  // the β line aligns with it), otherwise derive from the holdings' own
  // histories. priorMarketRet is only available from the analyzer.
  const startDays = useMemo<{ current: number; prior: number } | null>(() => {
    if (projectionCtx) {
      return {
        current: projectionCtx.currentStartMs,
        prior: projectionCtx.priorStartMs,
      };
    }
    const hist = [...histories.values()];
    const current = earliestDate(hist.map((h) => h.current));
    const prior = earliestDate(hist.map((h) => h.prior ?? []));
    return current !== null && prior !== null ? { current, prior } : null;
  }, [projectionCtx, histories]);

  // Two context flavours, stable across renders so PriorDetail's memo holds:
  // one carrying the prior market path (for the β line), one without.
  const ctxWithMarket = useMemo<ProjectionContext | null>(
    () =>
      startDays && projectionCtx
        ? {
            currentStartMs: startDays.current,
            priorStartMs: startDays.prior,
            priorMarketRet: projectionCtx.priorMarketRet,
          }
        : null,
    [startDays, projectionCtx],
  );
  const ctxNoMarket = useMemo<ProjectionContext | null>(
    () =>
      startDays
        ? {
            currentStartMs: startDays.current,
            priorStartMs: startDays.prior,
            priorMarketRet: [],
          }
        : null,
    [startDays],
  );

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onSelect(item: PricedItem) {
    setSelected(item);
    // Default the cost basis to the current price; the user adjusts to what
    // they actually paid.
    setBuy(String(item.unitDivines));
  }

  function add() {
    if (!selected) return;
    const quantity = parseNum(qty, 0);
    if (!(quantity > 0)) return;
    addPosition({
      key: selected.key,
      name: selected.name,
      category: selected.category,
      quantity,
      buyDivines: parseNum(buy, selected.unitDivines),
    });
    setSelected(null);
    setQty("1");
    setBuy("");
    setSearchKey((k) => k + 1);
  }

  const hasHoldings = positions.length > 0;

  return (
    <section className="results portfolio">
      <h2>Your portfolio</h2>

      <div className="controls portfolio-add">
        <ItemSearch
          key={searchKey}
          items={economy?.items ?? []}
          onSelect={onSelect}
          disabled={!economy || loading}
          placeholder="Search an item you bought…"
          label="Add holding"
        />
        <label>
          Quantity
          <input
            type="number"
            min={0}
            step={1}
            className="holding-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label title="What you paid per unit, in Divines. Defaults to the current price.">
          Buy price (div)
          <input
            type="number"
            min={0}
            step={0.001}
            className="holding-input"
            placeholder={
              selected ? formatNumber(selected.unitDivines, 3) : "0"
            }
            value={buy}
            onChange={(e) => setBuy(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="calculate"
          onClick={add}
          disabled={!selected || parseNum(qty, 0) <= 0}
        >
          Add
        </button>
      </div>

      {!hasHoldings ? (
        <p className="muted">
          No holdings yet. Search an item above (or use “Track” on an
          opportunity below) to start following your investments. Holdings are
          saved on this device and persist across restarts.
        </p>
      ) : (
        <>
          {valueSeries.length >= 2 && (
            <div className="portfolio-graph">
              <div className="prior-chart-head">
                <span className="prior-chart-title">
                  Portfolio value · current league
                </span>
              </div>
              <PortfolioChart
                series={valueSeries}
                costBasis={valuation.totalCost}
              />
            </div>
          )}

          {historyLoading && (
            <p className="muted">Loading holding price history…</p>
          )}

          <table className="holdings">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Buy</th>
                <th>Now</th>
                <th>Trend</th>
                <th>Value</th>
                <th>P&amp;L</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {valuation.rows.map(
                ({
                  position,
                  currentDivines,
                  marketValue,
                  profit,
                  returnPct,
                }) => {
                  const holding = histories.get(position.key);
                  const priorHistory = holding?.prior ?? null;
                  const currentHistory = holding?.current ?? [];
                  const isOpen = expanded.has(position.key);
                  const beta = betaByKey.get(position.key);
                  // Use the analyzer's market path only when we have a real
                  // beta for this item; otherwise project its own prior path.
                  const ctx =
                    beta !== undefined && ctxWithMarket
                      ? ctxWithMarket
                      : ctxNoMarket;
                  return (
                    <Fragment key={position.key}>
                  <tr>
                    <td className="holding-name">
                      {priorHistory && ctx && (
                        <button
                          type="button"
                          className="opp-expander"
                          aria-expanded={isOpen}
                          title={`Show ${PRIOR_LEAGUE} chart and projection`}
                          onClick={() => toggleExpanded(position.key)}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                      {position.name}
                      <span className="muted"> · {position.category}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="holding-input"
                        value={position.quantity}
                        onChange={(e) =>
                          updatePosition(position.key, {
                            quantity: parseNum(e.target.value, 0),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        className="holding-input"
                        value={position.buyDivines}
                        onChange={(e) =>
                          updatePosition(position.key, {
                            buyDivines: parseNum(e.target.value, 0),
                          })
                        }
                      />
                    </td>
                    <td>
                      {currentDivines === null
                        ? "—"
                        : `${formatNumber(currentDivines, 3)}`}
                    </td>
                    <td className="holding-trend">
                      {currentHistory.length >= 2 ? (
                        <Sparkline
                          data={currentHistory.map((h) => h.rate)}
                          width={84}
                          height={26}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {marketValue === null
                        ? "—"
                        : `${formatNumber(marketValue, 2)}`}
                    </td>
                    <td
                      className={
                        profit === null
                          ? "muted"
                          : profit >= 0
                            ? "opp-change up"
                            : "opp-change down"
                      }
                    >
                      {profit === null ? (
                        "no price"
                      ) : (
                        <>
                          {signedDiv(profit)}
                          {returnPct !== null && (
                            <span className="holding-pct">
                              {" "}
                              ({profit >= 0 ? "+" : "−"}
                              {formatNumber(Math.abs(returnPct) * 100, 1)}%)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="holding-remove"
                        title="Remove holding"
                        onClick={() => removePosition(position.key)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {isOpen && priorHistory && ctx && (
                    <tr className="holding-detail-row">
                      <td colSpan={8} className="holding-detail">
                        <PriorDetail
                          currentHistory={currentHistory}
                          priorHistory={priorHistory}
                          beta={beta ?? 0}
                          horizonDays={PROJECTION_HORIZON_DAYS}
                          ctx={ctx}
                        />
                      </td>
                    </tr>
                  )}
                    </Fragment>
                  );
                },
              )}
            </tbody>
          </table>

          <p className="portfolio-totals">
            Invested{" "}
            <strong>{formatNumber(valuation.totalCost, 2)} div</strong> · now
            worth <strong>{formatNumber(valuation.totalValue, 2)} div</strong> ·{" "}
            <strong
              className={
                valuation.totalProfit >= 0 ? "opp-change up" : "opp-change down"
              }
            >
              {signedDiv(valuation.totalProfit)} (
              {valuation.totalProfit >= 0 ? "+" : "−"}
              {formatNumber(Math.abs(valuation.totalReturnPct) * 100, 1)}%)
            </strong>
            {valuation.missing > 0 && (
              <span className="muted">
                {" "}
                · {valuation.missing} holding
                {valuation.missing === 1 ? "" : "s"} without a current price
                (excluded from totals)
              </span>
            )}
          </p>
        </>
      )}
    </section>
  );
}
