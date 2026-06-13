import { useMemo, useState } from "react";
import type { MergedEconomy, PricedItem } from "./api";
import { formatNumber } from "./format";
import ItemSearch from "./ItemSearch";
import { valuePortfolio, type Portfolio as PortfolioApi } from "./portfolio";

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
  loading,
  portfolio,
}: {
  economy: MergedEconomy | null;
  loading: boolean;
  portfolio: PortfolioApi;
}) {
  const { positions, addPosition, updatePosition, removePosition } = portfolio;

  const [selected, setSelected] = useState<PricedItem | null>(null);
  const [qty, setQty] = useState("1");
  const [buy, setBuy] = useState("");
  // Bumped after each add to remount (and so clear) the search box.
  const [searchKey, setSearchKey] = useState(0);

  const valuation = useMemo(
    () => valuePortfolio(positions, economy),
    [positions, economy],
  );

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
          <table className="holdings">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Buy</th>
                <th>Now</th>
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
                }) => (
                  <tr key={position.key}>
                    <td className="holding-name">
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
                ),
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
