import { useEffect, useMemo, useState } from "react";
import {
  fetchEconomy,
  fetchItemHistory,
  mapLimit,
  PRIOR_LEAGUE,
  type MergedEconomy,
  type PricedItem,
} from "./api";
import { formatNumber } from "./format";
import {
  DEFAULT_MIN_R_SQUARED,
  rankOpportunities,
  type ItemSeries,
} from "./invest";
import Sparkline from "./Sparkline";
import Portfolio from "./Portfolio";
import { usePortfolio } from "./portfolioStore";
import PriorDetail from "./PriorDetail";
import {
  leagueStartMs,
  priorMarketReturns,
  type ProjectionContext,
} from "./projection";

const DEFAULT_VOLUME_FLOOR = 500;
const DEFAULT_HORIZON_DAYS = 30;
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
  // Prior-league histories (for the per-item expander + projection only), and
  // whether the current results were fetched with them (to flag a stale toggle).
  const [usePrior, setUsePrior] = useState(false);
  const [priorSeries, setPriorSeries] = useState<ItemSeries[] | null>(null);
  const [ranWithPrior, setRanWithPrior] = useState(false);
  // How many days forward the projection extends, and which rows are expanded.
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const portfolio = usePortfolio(league);

  // Stale results shouldn't survive a league/data change.
  useEffect(() => {
    setSeries(null);
    setPriorSeries(null);
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
            priorSeries: priorSeries ?? undefined,
          })
        : null,
    [series, priorSeries, minRSquared, minPrice, maxPrice],
  );

  // Any change to the filtered set returns us to the first page.
  useEffect(() => {
    setPage(0);
  }, [series, priorSeries, minRSquared, minPrice, maxPrice]);

  // Shared inputs for every item's projection: each league's start day and the
  // prior league's cumulative market path. Recomputed only when the data does.
  const projectionCtx = useMemo<ProjectionContext | null>(() => {
    if (!series || !priorSeries) return null;
    const currentStartMs = leagueStartMs(series);
    const priorStartMs = leagueStartMs(priorSeries);
    if (currentStartMs === null || priorStartMs === null) return null;
    return {
      currentStartMs,
      priorStartMs,
      priorMarketRet: priorMarketReturns(priorSeries, priorStartMs),
    };
  }, [series, priorSeries]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function generate() {
    if (!economy || running) return;
    setRunning(true);
    setError(null);
    setSeries(null);
    setPriorSeries(null);

    const liquid = economy.items.filter(
      (item) => item.volumeDivines >= volumeFloor && item.detailsId,
    );

    try {
      // When pooling prior history, load that league's economy to learn which
      // of our liquid items existed then, and fetch only those (matched by the
      // same category + slug).
      let priorTargets: PricedItem[] = [];
      if (usePrior) {
        try {
          const priorEconomy = await fetchEconomy(PRIOR_LEAGUE);
          const priorByIdentity = new Map<string, PricedItem>();
          for (const it of priorEconomy.items) {
            if (it.detailsId) {
              priorByIdentity.set(`${it.type}:${it.detailsId}`, it);
            }
          }
          priorTargets = liquid
            .map((it) => priorByIdentity.get(`${it.type}:${it.detailsId}`))
            .filter((it): it is PricedItem => Boolean(it));
        } catch {
          // Prior data unavailable; fall back to a current-league-only run.
          priorTargets = [];
        }
      }

      const total = liquid.length + priorTargets.length;
      let done = 0;
      setProgress({ done, total });
      const bump = () => setProgress({ done: ++done, total });

      const fetchSeries = (forLeague: string, items: PricedItem[]) =>
        mapLimit<PricedItem, ItemSeries>(
          items,
          FETCH_CONCURRENCY,
          async (item) => {
            try {
              const history = await fetchItemHistory(
                forLeague,
                item.type,
                item.detailsId,
              );
              return { item, history };
            } catch {
              return { item, history: [] };
            }
          },
          bump,
        );

      const fetched = await fetchSeries(league, liquid);
      const prior = priorTargets.length
        ? await fetchSeries(PRIOR_LEAGUE, priorTargets)
        : [];

      setSeries(fetched);
      setPriorSeries(usePrior ? prior : null);
      setExpanded(new Set());
      setRanWithFloor(volumeFloor);
      setRanWithPrior(usePrior);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const floorStale = series !== null && ranWithFloor !== volumeFloor;
  const priorStale = series !== null && usePrior !== ranWithPrior;

  const trackedKeys = new Set(portfolio.positions.map((p) => p.key));

  const opps = report?.opportunities ?? [];
  const pageCount = Math.max(1, Math.ceil(opps.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageItems = opps.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <>
      <Portfolio economy={economy} loading={loading} portfolio={portfolio} />

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

        <label
          className="checkbox"
          title={`Fetch each item's price history from the previous league (${PRIOR_LEAGUE}). It doesn't change the ranking — items that existed then get a ▸ expander with their prior price chart and a forward projection.`}
        >
          <input
            type="checkbox"
            checked={usePrior}
            onChange={(e) => setUsePrior(e.target.checked)}
          />
          Include previous league history
        </label>

        {usePrior && (
          <label title="How many days forward the per-item projection extends, aligned by day-in-league.">
            Project (days)
            <input
              type="number"
              min={1}
              max={180}
              step={5}
              value={horizonDays}
              onChange={(e) =>
                setHorizonDays(
                  Math.max(1, Math.min(180, Math.floor(Number(e.target.value) || 1))),
                )
              }
            />
          </label>
        )}

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
          <dt>▸ expander</dt>
          <dd>
            Shown when “Include previous league history” is on and the item
            also existed in {PRIOR_LEAGUE}. Expand it for that league’s price
            chart and a forward projection of the current price — one line
            tracing the item’s own prior path from the same day-in-league, one
            from its β × that league’s market inflation. It never changes the
            β, R², or other figures on the row.
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

      {priorStale && (
        <p className="muted">
          Previous-league history {usePrior ? "enabled" : "disabled"} — re-run
          to apply.
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
                {ranWithPrior &&
                  (() => {
                    const withPrior = opps.filter((o) => o.priorHistory).length;
                    return withPrior > 0
                      ? ` ${formatNumber(withPrior, 0)} have ${PRIOR_LEAGUE} history — expand a ▸ row to see it.`
                      : ` None of these existed in ${PRIOR_LEAGUE}.`;
                  })()}
              </p>
              <ol className="opportunities" start={pageStart + 1}>
              {pageItems.map((opp) => (
                <li key={opp.item.key}>
                  <span className="opp-name">
                    {opp.priorHistory && projectionCtx && (
                      <button
                        type="button"
                        className="opp-expander"
                        aria-expanded={expanded.has(opp.item.key)}
                        title={`Show ${PRIOR_LEAGUE} chart and projection`}
                        onClick={() => toggleExpanded(opp.item.key)}
                      >
                        {expanded.has(opp.item.key) ? "▾" : "▸"}
                      </button>
                    )}
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
                    <button
                      type="button"
                      className="track"
                      disabled={trackedKeys.has(opp.item.key)}
                      title={
                        trackedKeys.has(opp.item.key)
                          ? "Already in your portfolio"
                          : "Add one unit to your portfolio at the current price"
                      }
                      onClick={() =>
                        portfolio.addPosition({
                          key: opp.item.key,
                          name: opp.item.name,
                          category: opp.item.category,
                          quantity: 1,
                          buyDivines: opp.item.unitDivines,
                        })
                      }
                    >
                      {trackedKeys.has(opp.item.key) ? "Tracked" : "Track"}
                    </button>
                  </span>
                  {expanded.has(opp.item.key) &&
                    opp.priorHistory &&
                    projectionCtx && (
                      <div className="opp-detail">
                        <PriorDetail
                          currentHistory={opp.history}
                          priorHistory={opp.priorHistory}
                          beta={opp.beta}
                          horizonDays={horizonDays}
                          ctx={projectionCtx}
                        />
                      </div>
                    )}
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
