import { formatNumber } from "./format";
import type { ProjectedPoint } from "./projection";

const COLORS = {
  actual: "#f1e4c2", // cream — current-league actual
  prior: "#86b46e", // green — follows the prior league's own path
  beta: "#c8a86a", // gold — beta × prior market inflation
  axis: "#463a27",
  today: "#6a583b",
  text: "#7c7156",
};

/**
 * Multi-line price chart for a forward projection, plotted on a shared
 * day-in-league x-axis: the current-league actual price up to today (solid),
 * then two projected paths forward (dashed). A vertical marker divides
 * "today" from the projection.
 */
export default function ProjectionChart({
  actual,
  priorPath,
  betaPath,
  currentDay,
  width = 360,
  height = 160,
}: {
  actual: ProjectedPoint[];
  priorPath: ProjectedPoint[];
  betaPath: ProjectedPoint[];
  currentDay: number;
  width?: number;
  height?: number;
}) {
  const all = [...actual, ...priorPath, ...betaPath];
  if (all.length < 2) {
    return (
      <p className="muted">
        Not enough aligned prior-league history past day {currentDay} to
        project.
      </p>
    );
  }

  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const days = all.map((p) => p.day);
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const dayRange = maxDay - minDay || 1;

  // Raw prior-league inflation spans several orders of magnitude, so a linear
  // axis squashes everything flat. Plot on log10 instead — straight-ish lines
  // whose slope reads as growth rate — keeping the real magnitudes intact.
  const prices = all.map((p) => p.price).filter((v) => v > 0);
  const minLog = Math.log10(Math.min(...prices));
  const maxLog = Math.log10(Math.max(...prices));
  const logRange = maxLog - minLog || 1;

  const x = (day: number) => padL + ((day - minDay) / dayRange) * w;
  const y = (price: number) =>
    padT + h - ((Math.log10(price) - minLog) / logRange) * h;

  const line = (pts: ProjectedPoint[]) =>
    pts
      .filter((p) => p.price > 0)
      .map((p) => `${x(p.day).toFixed(1)},${y(p.price).toFixed(1)}`)
      .join(" ");

  const todayX = x(currentDay);

  // Power-of-ten gridlines that fall inside the range, for log-scale reference.
  const decades: number[] = [];
  for (let k = Math.ceil(minLog); k <= Math.floor(maxLog); k++) {
    decades.push(k);
  }

  return (
    <svg
      width={width}
      height={height}
      className="projection-chart"
      role="img"
      aria-label="Forward price projection"
    >
      {/* log-scale y-axis: power-of-ten gridlines, or just the bounds */}
      {decades.length >= 2 ? (
        decades.map((k) => {
          const price = 10 ** k;
          return (
            <g key={k}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y(price)}
                y2={y(price)}
                stroke={COLORS.axis}
                strokeWidth={1}
                strokeDasharray="1 3"
              />
              <text
                x={0}
                y={y(price) + 3}
                className="proj-axis-label"
                fill={COLORS.text}
              >
                {formatNumber(price, price >= 10 ? 0 : 2)}
              </text>
            </g>
          );
        })
      ) : (
        <>
          <text
            x={0}
            y={padT + 8}
            className="proj-axis-label"
            fill={COLORS.text}
          >
            {formatNumber(10 ** maxLog, 10 ** maxLog >= 10 ? 0 : 2)}
          </text>
          <text x={0} y={padT + h} className="proj-axis-label" fill={COLORS.text}>
            {formatNumber(10 ** minLog, 10 ** minLog >= 10 ? 0 : 2)}
          </text>
        </>
      )}

      {/* "today" divider between actuals and projection */}
      <line
        x1={todayX}
        x2={todayX}
        y1={padT}
        y2={padT + h}
        stroke={COLORS.today}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={todayX}
        y={height - 6}
        textAnchor="middle"
        className="proj-axis-label"
        fill={COLORS.text}
      >
        today · day {currentDay}
      </text>
      <text
        x={padL}
        y={height - 6}
        textAnchor="start"
        className="proj-axis-label"
        fill={COLORS.text}
      >
        d{minDay}
      </text>
      <text
        x={width - padR}
        y={height - 6}
        textAnchor="end"
        className="proj-axis-label"
        fill={COLORS.text}
      >
        d{maxDay}
      </text>

      {betaPath.length >= 2 && (
        <polyline
          points={line(betaPath)}
          fill="none"
          stroke={COLORS.beta}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
      )}
      {priorPath.length >= 2 && (
        <polyline
          points={line(priorPath)}
          fill="none"
          stroke={COLORS.prior}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
      )}
      {actual.length >= 2 && (
        <polyline
          points={line(actual)}
          fill="none"
          stroke={COLORS.actual}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
