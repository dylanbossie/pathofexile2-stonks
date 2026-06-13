interface SparklineProps {
  /** Cumulative % change points over the window. */
  data: number[];
  width?: number;
  height?: number;
  /** Line color hint; defaults to up=green / down=red by net direction. */
  positive?: boolean;
}

/**
 * Tiny inline SVG line chart for a series of values. Scales the line to
 * the data's own min/max and draws a faint baseline at zero when it falls
 * inside that range.
 */
export default function Sparkline({
  data,
  width = 120,
  height = 36,
  positive,
}: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} className="sparkline" />;
  }

  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const y = (v: number) => pad + h - ((v - min) / range) * h;
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * w;
      return `${x.toFixed(1)},${y(v).toFixed(1)}`;
    })
    .join(" ");

  const up = positive ?? data[data.length - 1] >= data[0];
  const stroke = up ? "#86b46e" : "#c25a4e";
  // Only meaningful for series that straddle zero (e.g. % change).
  const showBaseline = min < 0 && max > 0;

  return (
    <svg
      width={width}
      height={height}
      className="sparkline"
      role="img"
      aria-label={`Trend, net ${up ? "up" : "down"}`}
    >
      {showBaseline && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(0)}
          y2={y(0)}
          stroke="#463a27"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
