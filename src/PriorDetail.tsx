import { useMemo, useState } from "react";
import { PRIOR_LEAGUE, type HistoryPoint } from "./api";
import { formatNumber } from "./format";
import Sparkline from "./Sparkline";
import ProjectionChart from "./ProjectionChart";
import CompareChart from "./CompareChart";
import { projectItem, toDayPoints, type ProjectionContext } from "./projection";

const DAY_MS = 86_400_000;

/**
 * The fraction (0–1) along the prior history's index axis where "today" — our
 * current day-in-league — falls, so the prior price chart can mark it with the
 * same dotted line as the projection. Returns undefined when today sits outside
 * the prior history's range or it's too short to mark.
 */
function priorMarkerFraction(
  priorHistory: HistoryPoint[],
  ctx: ProjectionContext,
  currentHistory: HistoryPoint[],
): number | undefined {
  const n = priorHistory.length;
  if (n < 2 || currentHistory.length === 0) return undefined;

  const lastCurrent = currentHistory[currentHistory.length - 1].date;
  const currentDay = Math.round(
    (Date.parse(lastCurrent) - ctx.currentStartMs) / DAY_MS,
  );
  const priorDays = priorHistory.map((h) =>
    Math.round((Date.parse(h.date) - ctx.priorStartMs) / DAY_MS),
  );

  if (currentDay <= priorDays[0]) return 0;
  if (currentDay >= priorDays[n - 1]) return 1;
  for (let i = 0; i < n - 1; i++) {
    if (currentDay >= priorDays[i] && currentDay <= priorDays[i + 1]) {
      const span = priorDays[i + 1] - priorDays[i] || 1;
      const fracIndex = i + (currentDay - priorDays[i]) / span;
      return fracIndex / (n - 1);
    }
  }
  return undefined;
}

/**
 * The expandable prior-league panel for one item: its Fate of the Vaal price
 * chart (mirroring the current-league sparkline), and a forward projection of
 * the current price built from that league's trajectory.
 */
export default function PriorDetail({
  currentHistory,
  priorHistory,
  beta,
  horizonDays,
  ctx,
}: {
  currentHistory: HistoryPoint[];
  priorHistory: HistoryPoint[];
  beta: number;
  horizonDays: number;
  ctx: ProjectionContext;
}) {
  const projection = useMemo(
    () => projectItem(currentHistory, priorHistory, beta, horizonDays, ctx),
    [currentHistory, priorHistory, beta, horizonDays, ctx],
  );

  const priorRates = priorHistory.map((h) => h.rate);
  const priorChange =
    priorHistory.length > 1 && priorHistory[0].rate > 0
      ? priorRates[priorRates.length - 1] / priorRates[0] - 1
      : 0;

  // Where "today" (our current day-in-league) lands on the prior-league
  // timeline, as a fraction across the sparkline's index axis — so the same
  // dotted marker as the projection appears on the prior price chart.
  const todayMarker = useMemo(
    () => priorMarkerFraction(priorHistory, ctx, currentHistory),
    [priorHistory, ctx, currentHistory],
  );

  // Overlay of the current-league price onto the prior chart, for trend
  // comparison up to today.
  const [overlayCurrent, setOverlayCurrent] = useState(false);
  const fotvPoints = useMemo(
    () => toDayPoints(priorHistory, ctx.priorStartMs),
    [priorHistory, ctx],
  );
  const currentPoints = useMemo(
    () => toDayPoints(currentHistory, ctx.currentStartMs),
    [currentHistory, ctx],
  );
  const currentDay = useMemo(() => {
    if (currentHistory.length === 0) return 0;
    const last = currentHistory[currentHistory.length - 1].date;
    return Math.round((Date.parse(last) - ctx.currentStartMs) / DAY_MS);
  }, [currentHistory, ctx]);

  return (
    <div className="prior-detail">
      <div className="prior-chart">
        <div className="prior-chart-head">
          <span className="prior-chart-title">
            {PRIOR_LEAGUE} price{overlayCurrent ? " · log scale" : ""}
          </span>
          <span
            className={priorChange >= 0 ? "opp-change up" : "opp-change down"}
          >
            {priorChange >= 0 ? "+" : ""}
            {formatNumber(priorChange * 100, 0)}% over {priorHistory.length}d
          </span>
          <label
            className="overlay-toggle"
            title="Overlay this league's price, aligned by day-in-league, to compare the trend so far."
          >
            <input
              type="checkbox"
              checked={overlayCurrent}
              onChange={(e) => setOverlayCurrent(e.target.checked)}
            />
            Overlay current
          </label>
        </div>
        {overlayCurrent ? (
          <>
            <CompareChart
              fotv={fotvPoints}
              current={currentPoints}
              currentDay={currentDay}
            />
            <div className="prior-legend">
              <span className="proj-key fotv">{PRIOR_LEAGUE}</span>
              <span className="proj-key current">Current league</span>
            </div>
          </>
        ) : (
          <Sparkline
            data={priorRates}
            width={360}
            height={70}
            markerFraction={todayMarker}
          />
        )}
      </div>

      <div className="prior-chart">
        <div className="prior-chart-head">
          <span className="prior-chart-title">
            Projection · next {horizonDays}d · log scale
          </span>
        </div>
        {projection ? (
          <>
            <ProjectionChart
              actual={projection.actual}
              priorPath={projection.priorPath}
              betaPath={projection.betaPath}
              currentDay={projection.currentDay}
            />
            <div className="prior-legend">
              <span className="proj-key actual">Current price</span>
              <span className="proj-key prior">
                Follows {PRIOR_LEAGUE} path
              </span>
              <span className="proj-key beta">β × {PRIOR_LEAGUE} market</span>
            </div>
          </>
        ) : (
          <p className="muted">Not enough current-league history to anchor.</p>
        )}
      </div>

      <p className="muted prior-note">
        Projection assumes this item repeats its {PRIOR_LEAGUE} path from the
        same day-in-league, at full strength — a what-if, not a forecast. That
        league saw extreme inflation, so treat the magnitude as an upper bound.
      </p>
    </div>
  );
}
