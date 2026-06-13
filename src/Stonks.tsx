import { useEffect, useState } from "react";
import { type MergedEconomy, type PricedItem } from "./api";
import { formatNumber } from "./format";
import Sparkline from "./Sparkline";

/** Minimum trade volume (in divines) for an item to count as liquid. */
const VOLUME_FLOOR_DIVINES = 500;
const TOP_N = 10;

export default function Stonks({
  economy,
  loading,
}: {
  economy: MergedEconomy | null;
  loading: boolean;
}) {
  const [picks, setPicks] = useState<PricedItem[] | null>(null);

  // Stale picks shouldn't survive a league/data change.
  useEffect(() => {
    setPicks(null);
  }, [economy]);

  function generate() {
    if (!economy) return;
    const ranked = economy.items
      .filter((item) => item.volumeDivines >= VOLUME_FLOOR_DIVINES)
      .sort((a, b) => b.totalChange - a.totalChange)
      .slice(0, TOP_N);
    setPicks(ranked);
  }

  return (
    <>
      <div className="controls">
        <button
          type="button"
          className="calculate"
          onClick={generate}
          disabled={!economy || loading}
        >
          Find investment opportunities
        </button>
        <p className="muted stonks-criteria">
          Top {TOP_N} items by 7-day value gain, among those trading at ≥{" "}
          {formatNumber(VOLUME_FLOOR_DIVINES, 0)} divines volume.
        </p>
      </div>

      {picks && picks.length === 0 && (
        <p className="muted">
          No items meet the {formatNumber(VOLUME_FLOOR_DIVINES, 0)}-divine
          volume threshold in this league.
        </p>
      )}

      {picks && picks.length > 0 && (
        <section className="results">
          <ol className="opportunities">
            {picks.map((item) => (
              <li key={item.key}>
                <span className="opp-name">
                  {item.name}
                  <span className="muted"> · {item.category}</span>
                </span>
                <Sparkline
                  data={item.sparkline}
                  positive={item.totalChange >= 0}
                />
                <span
                  className={
                    item.totalChange >= 0 ? "opp-change up" : "opp-change down"
                  }
                >
                  {item.totalChange >= 0 ? "+" : ""}
                  {formatNumber(item.totalChange, 1)}%
                </span>
                <span className="opp-meta muted">
                  {formatNumber(item.unitDivines, 3)} div · vol{" "}
                  {formatNumber(item.volumeDivines, 0)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
