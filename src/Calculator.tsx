import { useEffect, useMemo, useRef, useState } from "react";
import { EXCHANGE_TYPES, type MergedEconomy, type PricedItem } from "./api";
import { formatNumber } from "./format";

/**
 * Builds a case-insensitive subsequence regex: "annul" becomes
 * /a.*n.*n.*u.*l/i, matching names that contain those letters in order
 * but not necessarily adjacent. Each character is escaped so regex
 * metacharacters in the query are matched literally.
 */
function subsequenceRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

interface SaleResult {
  itemName: string;
  amount: number;
  unitDivines: number;
  unitExalts: number;
  totalDivinesExact: number;
  totalExaltsExact: number;
  /** Complete sale price if selling in exalts. */
  sellExalts: number;
  /** Complete sale price if selling in divines (rounded down, no remainder). */
  sellDivines: number;
  /** What the divine sale is actually worth, in exalts. */
  sellDivinesInExalts: number;
  recommend: "exalts" | "divines";
}

export default function Calculator({
  economy,
  loading,
}: {
  economy: MergedEconomy | null;
  loading: boolean;
}) {
  const [itemKey, setItemKey] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLLabelElement>(null);
  const [amount, setAmount] = useState<number>(1);
  const [result, setResult] = useState<SaleResult | null>(null);

  // Reset selection when the economy (league) changes.
  useEffect(() => {
    setItemKey("");
    setQuery("");
    setResult(null);
  }, [economy]);

  /** Matches, sorted by category (in registry order) then name. */
  const matches = useMemo(() => {
    if (!economy) return [];
    const regex = subsequenceRegex(query);
    const categoryOrder = new Map(
      EXCHANGE_TYPES.map(({ label }, i) => [label, i]),
    );
    return economy.items
      .filter((item) => regex.test(item.name))
      .sort(
        (a, b) =>
          (categoryOrder.get(a.category) ?? 99) -
            (categoryOrder.get(b.category) ?? 99) ||
          a.name.localeCompare(b.name),
      );
  }, [economy, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, searchOpen]);

  // Close the suggestion list on any click outside the search box.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!searchRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const selectedItem =
    economy?.items.find((item) => item.key === itemKey) ?? null;

  function selectItem(item: PricedItem) {
    setItemKey(item.key);
    setQuery(item.name);
    setSearchOpen(false);
    setResult(null);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchOpen(true);
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchOpen && matches[highlighted]) selectItem(matches[highlighted]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  function calculate() {
    if (!economy || !selectedItem || amount < 1) return;
    const { exaltsPerDivine } = economy;
    const unitDivines = selectedItem.unitDivines;
    const totalDivinesExact = unitDivines * amount;
    const totalExaltsExact = totalDivinesExact * exaltsPerDivine;
    const sellExalts = Math.floor(totalExaltsExact);
    // House rule: a divine sale is floor(divines), full stop — the
    // fraction is forfeited, not topped up with exalts. Recommend the
    // denomination using these post-rounding prices.
    const sellDivines = Math.floor(totalDivinesExact);
    const sellDivinesInExalts = sellDivines * exaltsPerDivine;
    setResult({
      itemName: selectedItem.name,
      amount,
      unitDivines,
      unitExalts: unitDivines * exaltsPerDivine,
      totalDivinesExact,
      totalExaltsExact,
      sellExalts,
      sellDivines,
      sellDivinesInExalts,
      recommend:
        sellDivines > 0 && sellDivinesInExalts >= sellExalts
          ? "divines"
          : "exalts",
    });
  }

  return (
    <>
      <div className="controls">
        <label className="search" ref={searchRef}>
          Item
          <input
            type="text"
            placeholder="Type to search, e.g. annul"
            value={query}
            disabled={!economy || loading}
            onChange={(e) => {
              setQuery(e.target.value);
              setItemKey("");
              setResult(null);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={onSearchKeyDown}
          />
          {searchOpen && economy && (
            <ul className="suggestions">
              {matches.length === 0 && (
                <li className="muted">No items match “{query}”</li>
              )}
              {matches.map((item, i) => (
                <li
                  key={item.key}
                  className={i === highlighted ? "highlighted" : ""}
                  onMouseDown={() => selectItem(item)}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  <span>{item.name}</span>
                  <span className="muted">{item.category}</span>
                </li>
              ))}
            </ul>
          )}
        </label>

        <label>
          Amount
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => {
              setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)));
              setResult(null);
            }}
          />
        </label>

        <button
          type="button"
          className="calculate"
          onClick={calculate}
          disabled={!selectedItem || loading}
        >
          Calculate sale
        </button>
      </div>

      {result && (
        <section className="results">
          <h2>
            {formatNumber(result.amount, 0)} × {result.itemName}
          </h2>
          <table>
            <tbody>
              <tr>
                <td>Value per unit</td>
                <td>
                  {formatNumber(result.unitExalts, 2)} ex /{" "}
                  {formatNumber(result.unitDivines, 4)} div
                </td>
              </tr>
              <tr>
                <td>Exact market value</td>
                <td>
                  {formatNumber(result.totalExaltsExact, 2)} ex /{" "}
                  {formatNumber(result.totalDivinesExact, 4)} div
                </td>
              </tr>
              <tr className={result.recommend === "exalts" ? "best" : ""}>
                <td>Sell in exalts</td>
                <td>{formatNumber(result.sellExalts, 0)} ex</td>
              </tr>
              <tr className={result.recommend === "divines" ? "best" : ""}>
                <td>Sell in divines (rounded down)</td>
                <td>
                  {formatNumber(result.sellDivines, 0)} div
                  <span className="muted">
                    {" "}
                    = {formatNumber(result.sellDivinesInExalts, 0)} ex
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="sell">
            {result.recommend === "divines" ? (
              <>
                Sell for:{" "}
                <strong>{formatNumber(result.sellDivines, 0)} div</strong>
                <span className="muted">
                  {" "}
                  — beats {formatNumber(result.sellExalts, 0)} ex
                </span>
              </>
            ) : (
              <>
                Sell for:{" "}
                <strong>{formatNumber(result.sellExalts, 0)} ex</strong>
                <span className="muted">
                  {result.sellDivines > 0
                    ? ` — beats ${formatNumber(result.sellDivines, 0)} div (${formatNumber(result.sellDivinesInExalts, 0)} ex)`
                    : " — worth less than 1 div"}
                </span>
              </>
            )}
          </p>
        </section>
      )}
    </>
  );
}
