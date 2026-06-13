import { formatNumber } from "./format";
import type { ProjectedPoint } from "./projection";

const COLORS = {
  axis: "#463a27",
  today: "#6a583b",
  text: "#7c7156",
  fotv: "#86b46e", // prior league
  current: "#f1e4c2", // current league
};

/**
 * Overlays the current-league price on the prior-league price, both plotted by
 * day-in-league on a shared log10 axis so the two very different price scales
 * stay comparable — a similar trend reads as parallel slopes. A dotted marker
 * shows today (where the current-league line ends).
 */
export default function CompareChart({
  fotv,
  current,
  currentDay,
  width = 360,
  height = 92,
}: {
  fotv: ProjectedPoint[];
  current: ProjectedPoint[] | null;
  currentDay: number;
  width?: number;
  height?: number;
}) {
  const shown = [...fotv, ...(current ?? [])].filter((p) => p.price > 0);
  if (shown.length < 2) {
    return <svg width={width} height={height} className="projection-chart" />;
  }

  const padL = 40;
  const padR = 8;
  const padT = 8;
  const padB = 8;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const days = shown.map((p) => p.day);
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const dayRange = maxDay - minDay || 1;

  const prices = shown.map((p) => p.price);
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

  const decades: number[] = [];
  for (let k = Math.ceil(minLog); k <= Math.floor(maxLog); k++) decades.push(k);

  const markerX = x(currentDay);

  return (
    <svg
      width={width}
      height={height}
      className="projection-chart"
      role="img"
      aria-label="Current vs prior league price"
    >
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

      {currentDay >= minDay && currentDay <= maxDay && (
        <line
          x1={markerX}
          x2={markerX}
          y1={padT}
          y2={padT + h}
          stroke={COLORS.today}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      <polyline
        points={line(fotv)}
        fill="none"
        stroke={COLORS.fotv}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {current && current.length >= 2 && (
        <polyline
          points={line(current)}
          fill="none"
          stroke={COLORS.current}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
