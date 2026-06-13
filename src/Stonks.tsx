import { useEffect, useState } from "react";
import {
  fetchItemHistory,
  mapLimit,
  type MergedEconomy,
} from "./api";
import { formatNumber } from "./format";
import { rankOpportunities, type InvestmentReport, type ItemSeries } from "./invest";
import Sparkline from "./Sparkline";

/** Minimum trade volume (in divines) for an item to count as liquid. */
const VOLUME_FLOOR_DIVINES = 500;
const TOP_N = 10;
/** Concurrent detail requests; poe.ninja tolerates this comfortably. */
const FETCH_CONCURRENCY = 8;

export default function Stonks({
  economy,
  league,
  loading,
}: {
  economy: MergedEconomy | null;
  league: string;
  loading: boolean;
}) {
  const [report, setReport] = useState<InvestmentReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Stale results shouldn't survive a league/data change.
  useEffect(() => {
    setReport(null);
    setError(null);
  }, [economy]);

  async function generate() {
    if (!economy || running) return;
    setRunning(true);
    setError(null);
    setReport(null);

    const liquid = economy.items.filter(
      (item) => item.volumeDivines >= VOLUME_FLOOR_DIVINES && item.detailsId,
    );
    setProgress({ done: 0, total: liquid.length });

    try {
      const series = await mapLimit<typeof liquid[number], ItemSeries>(
        liquid,
        FETCH_CONCURRENCY,
        async (item) => {
          try {
            const history = await fetchItemHistory(
              league,
              item.type,
              item.detailsId,
            );
            return { item, history };
          } catch {
            return { item, history: [] };
          }
        },
        (done, total) => setProgress({ done, total }),
      );
      setReport(rankOpportunities(series, TOP_N));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="controls">
        <button
          type="button"
          className="calculate"
          onClick={generate}
          disabled={!economy || loading || running}
        >
          {running ? "Analyzing…" : "Find investment opportunities"}
        </button>
        <p className="muted stonks-criteria">
          Ranks the top {TOP_N} items by <strong>inflation beta</strong> —
          how hard each amplifies the market-wide price trend — among items
          trading at ≥ {formatNumber(VOLUME_FLOOR_DIVINES, 0)} divines volume,
          using full daily price history in divines.
        </p>
      </div>

      {running && progress.total > 0 && (
        <p className="muted">
          Fetching price history… {progress.done}/{progress.total}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {report && (
        <section className="results">
          <p className="ratio">
            Market drifted{" "}
            <strong
              className={report.marketDrift >= 0 ? "opp-change up" : "opp-change down"}
            >
              {report.marketDrift >= 0 ? "+" : ""}
              {formatNumber(report.marketDrift * 100, 0)}%
            </strong>{" "}
            over the last {report.windowDays} days (volume-weighted basket).
            {report.marketDrift <= 0 && (
              <span className="muted">
                {" "}
                — basket isn't inflating, so high-beta items may be falling.
              </span>
            )}
          </p>

          {report.opportunities.length === 0 ? (
            <p className="muted">
              No items cleared the liquidity, history, and market-tracking
              filters in this league.
            </p>
          ) : (
            <ol className="opportunities">
              {report.opportunities.map((opp) => (
                <li key={opp.item.key}>
                  <span className="opp-name">
                    {opp.item.name}
                    <span className="muted"> · {opp.item.category}</span>
                  </span>
                  <Sparkline
                    data={opp.history.map((h) => h.rate)}
                    positive={opp.realizedChange >= 0}
                  />
                  <span className="opp-change up">β {formatNumber(opp.beta, 1)}</span>
                  <span className="opp-meta muted">
                    R² {formatNumber(opp.rSquared, 2)} · {opp.realizedChange >= 0 ? "+" : ""}
                    {formatNumber(opp.realizedChange * 100, 0)}% realized ·{" "}
                    {formatNumber(opp.item.unitDivines, 3)} div · vol{" "}
                    {formatNumber(opp.item.volumeDivines, 0)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
