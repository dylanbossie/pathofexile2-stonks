import { useEffect, useMemo, useState } from "react";
import { fetchItemHistory, mapLimit, type MergedEconomy } from "./api";
import { formatNumber } from "./format";
import {
  DEFAULT_MIN_R_SQUARED,
  rankOpportunities,
  type ItemSeries,
} from "./invest";
import Sparkline from "./Sparkline";

const DEFAULT_VOLUME_FLOOR = 500;
const PAGE_SIZE = 10;
/** Concurrent detail requests; poe.ninja tolerates this comfortably. */
const FETCH_CONCURRENCY = 8;

/** Parse a price input; blank/invalid means "no limit" via the fallback. */
function parsePrice(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default function Stonks({
  economy,
  league,
  loading,
}: {
  economy: MergedEconomy | null;
  league: string;
  loading: boolean;
}) {
  const [volumeFloor, setVolumeFloor] = useState(DEFAULT_VOLUME_FLOOR);
  const [minRSquared, setMinRSquared] = useState(DEFAULT_MIN_R_SQUARED);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [page, setPage] = useState(0);
  // The fetched histories from the last run, plus the volume floor they
  // were fetched with (so we can tell the user when it's gone stale).
  const [series, setSeries] = useState<ItemSeries[] | null>(null);
  const [ranWithFloor, setRanWithFloor] = useState(volumeFloor);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Stale results shouldn't survive a league/data change.
  useEffect(() => {
    setSeries(null);
    setError(null);
  }, [economy]);

  // R² and the price window only filter the final ranking, so re-rank
  // instantly with no refetch. (Volume floor changes the fetched set and
  // the market basket, so it requires re-running.)
  const report = useMemo(
    () =>
      series
        ? rankOpportunities(series, {
            minRSquared,
            minPrice: parsePrice(minPrice, 0),
            maxPrice: parsePrice(maxPrice, Infinity),
          })
        : null,
    [series, minRSquared, minPrice, maxPrice],
  );

  // Any change to the filtered set returns us to the first page.
  useEffect(() => {
    setPage(0);
  }, [series, minRSquared, minPrice, maxPrice]);

  async function generate() {
    if (!economy || running) return;
    setRunning(true);
    setError(null);
    setSeries(null);

    const liquid = economy.items.filter(
      (item) => item.volumeDivines >= volumeFloor && item.detailsId,
    );
    setProgress({ done: 0, total: liquid.length });

    try {
      const fetched = await mapLimit<(typeof liquid)[number], ItemSeries>(
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
      setSeries(fetched);
      setRanWithFloor(volumeFloor);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const floorStale = series !== null && ranWithFloor !== volumeFloor;

  const opps = report?.opportunities ?? [];
  const pageCount = Math.max(1, Math.ceil(opps.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageItems = opps.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <>
      <div className="controls">
        <label title="Only consider items trading at least this much volume (in Divines). Higher = only deep, liquid markets you can actually buy and sell in.">
          Min volume (div)
          <input
            type="number"
            min={0}
            step={50}
            value={volumeFloor}
            onChange={(e) =>
              setVolumeFloor(Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
          />
        </label>

        <label title="Only show opportunities priced at or above this many Divines per unit. Leave blank for no minimum.">
          Min price (div)
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="0"
            className="price-input"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
        </label>

        <label title="Only show opportunities priced at or below this many Divines per unit. Leave blank for no maximum.">
          Max price (div)
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="∞"
            className="price-input"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </label>

        <label title="Hide items whose price doesn't reliably track the economy. Higher = stricter, fewer but more dependable results.">
          Min R² ({formatNumber(minRSquared, 2)})
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={minRSquared}
            onChange={(e) => setMinRSquared(Number(e.target.value))}
          />
        </label>

        <button
          type="button"
          className="calculate"
          onClick={generate}
          disabled={!economy || loading || running}
        >
          {running ? "Analyzing…" : "Find investment opportunities"}
        </button>
      </div>

      <p className="muted stonks-criteria">
        Ranks items by <strong>inflation beta</strong> — how hard each
        amplifies the market-wide price trend — among items trading at ≥{" "}
        {formatNumber(volumeFloor, 0)} divines volume, using full daily price
        history in divines. R² and the price window filter the list; results
        are paginated {PAGE_SIZE} per page.
      </p>

      <details className="legend">
        <summary>How to read these results</summary>
        <dl>
          <dt>Market drift</dt>
          <dd>
            The economy's overall inflation for the period — the average price
            change across all traded items. Positive means things are getting
            more expensive in Divines.
          </dd>
          <dt>β (beta)</dt>
          <dd>
            How hard an item moves when the whole economy moves 1%. β&nbsp;2
            swings twice as hard as average. Higher β = bigger expected gains
            while inflation continues (and bigger drops if it reverses). The
            list is sorted by this.
          </dd>
          <dt>R²</dt>
          <dd>
            How dependable that β is, from 0 to 1. Near 1 = the item reliably
            tracks the economy. Near 0 = its price is noisy and the β is
            basically luck. The slider hides items below your chosen R².
          </dd>
          <dt>Sparkline</dt>
          <dd>
            The item's actual Divine price over time. Green ended higher than
            it started, red lower. A smooth climb is more trustworthy than a
            jagged spike.
          </dd>
          <dt>Realized %</dt>
          <dd>
            The price change that already happened over the window
            (backward-looking), so you can sanity-check the forward-looking β.
          </dd>
          <dt>div · vol</dt>
          <dd>
            Current price of one unit in Divines, and how much is being traded
            (in Divines). High volume = an active market you can actually buy
            and sell in.
          </dd>
        </dl>
        <p className="muted">
          All of this is built from past prices — it finds historically
          inflation-sensitive items, but can't predict patches or meta shifts.
        </p>
      </details>

      {running && progress.total > 0 && (
        <p className="muted">
          Fetching price history… {progress.done}/{progress.total}
        </p>
      )}

      {floorStale && (
        <p className="muted">
          Volume floor changed to {formatNumber(volumeFloor, 0)} — re-run to
          apply (showing results for ≥ {formatNumber(ranWithFloor, 0)}).
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {report && (
        <section className="results">
          <p
            className="ratio"
            title="The economy's overall inflation over this window — the volume-weighted average price change across all traded items."
          >
            Market drifted{" "}
            <strong
              className={
                report.marketDrift >= 0 ? "opp-change up" : "opp-change down"
              }
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

          {opps.length === 0 ? (
            <p className="muted">
              No items cleared the volume, history, price, and R² ≥{" "}
              {formatNumber(minRSquared, 2)} filters. Try widening the price
              window or lowering the thresholds.
            </p>
          ) : (
            <>
              <p className="muted">
                {formatNumber(opps.length, 0)} matching item
                {opps.length === 1 ? "" : "s"}, ranked by beta.
              </p>
              <ol className="opportunities" start={pageStart + 1}>
              {pageItems.map((opp) => (
                <li key={opp.item.key}>
                  <span className="opp-name">
                    {opp.item.name}
                    <span className="muted"> · {opp.item.category}</span>
                  </span>
                  <Sparkline
                    data={opp.history.map((h) => h.rate)}
                    positive={opp.realizedChange >= 0}
                  />
                  <span
                    className="opp-change up"
                    title="Beta: how hard this item moves when the economy moves 1%. Higher = bigger expected gains while inflation continues."
                  >
                    β {formatNumber(opp.beta, 1)}
                  </span>
                  <span className="opp-meta muted">
                    <span title="How dependable the beta is (0–1); higher = more reliable.">
                      R² {formatNumber(opp.rSquared, 2)}
                    </span>{" "}
                    ·{" "}
                    <span title="Price change that already happened over the window.">
                      {opp.realizedChange >= 0 ? "+" : ""}
                      {formatNumber(opp.realizedChange * 100, 0)}% realized
                    </span>{" "}
                    ·{" "}
                    <span title="Current price of one unit, in Divines.">
                      {formatNumber(opp.item.unitDivines, 3)} div
                    </span>{" "}
                    ·{" "}
                    <span title="Trade volume in Divines; higher = a more liquid market.">
                      vol {formatNumber(opp.item.volumeDivines, 0)}
                    </span>
                  </span>
                </li>
              ))}
              </ol>

              {pageCount > 1 && (
                <div className="pager">
                  <button
                    type="button"
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage === 0}
                  >
                    ‹ Prev
                  </button>
                  <span className="muted">
                    Page {safePage + 1} of {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= pageCount - 1}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
