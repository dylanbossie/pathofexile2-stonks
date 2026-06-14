import { formatNumber } from "./format";
import type { ValuePoint } from "./portfolioHistory";

const COLORS = {
  up: "#86b46e",
  down: "#c25a4e",
  cost: "#9a7f55",
  axis: "#463a27",
  text: "#7c7156",
};

/**
 * The portfolio's total market value across the current league, plotted on a
 * linear axis with the total cost basis drawn as a dashed reference line — so
 * the gap between the value line and that line reads as unrealized P&L. Green
 * when the latest value is above cost, red below.
 */
export default function PortfolioChart({
  series,
  costBasis,
  width = 620,
  height = 150,
}: {
  series: ValuePoint[];
  costBasis: number;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;

  const padL = 54;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const values = series.map((p) => p.value);
  const hasCost = costBasis > 0;
  const min = Math.min(...values, hasCost ? costBasis : Infinity);
  const max = Math.max(...values, hasCost ? costBasis : -Infinity);
  const range = max - min || 1;

  const x = (i: number) => padL + (i / (series.length - 1)) * w;
  const y = (v: number) => padT + h - ((v - min) / range) * h;

  const points = series
    .map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");

  const last = values[values.length - 1];
  const inProfit = !hasCost || last >= costBasis;
  const stroke = inProfit ? COLORS.up : COLORS.down;
  const costY = y(costBasis);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="projection-chart portfolio-chart"
      role="img"
      aria-label="Portfolio value over the current league"
    >
      {/* y-axis bounds */}
      <text x={0} y={padT + 8} className="proj-axis-label" fill={COLORS.text}>
        {formatNumber(max, max >= 10 ? 0 : 2)}
      </text>
      <text x={0} y={padT + h} className="proj-axis-label" fill={COLORS.text}>
        {formatNumber(min, min >= 10 ? 0 : 2)}
      </text>

      {/* cost-basis reference line */}
      {hasCost && costY >= padT && costY <= padT + h && (
        <>
          <line
            x1={padL}
            x2={width - padR}
            y1={costY}
            y2={costY}
            stroke={COLORS.cost}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={width - padR}
            y={costY - 3}
            textAnchor="end"
            className="proj-axis-label"
            fill={COLORS.cost}
          >
            cost {formatNumber(costBasis, costBasis >= 10 ? 0 : 2)}
          </text>
        </>
      )}

      {/* date endpoints */}
      <text
        x={padL}
        y={height - 6}
        textAnchor="start"
        className="proj-axis-label"
        fill={COLORS.text}
      >
        {series[0].date.slice(5)}
      </text>
      <text
        x={width - padR}
        y={height - 6}
        textAnchor="end"
        className="proj-axis-label"
        fill={COLORS.text}
      >
        {series[series.length - 1].date.slice(5)}
      </text>

      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
