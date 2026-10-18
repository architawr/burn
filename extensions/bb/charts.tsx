import type { ReactNode } from "react";

const WIDTH = 200;
const HEIGHT = 46;
const PAD = 4;

interface ChartProps {
  values: number[];
  className?: string;
}

/** A filled line of the values, scaled to their range. */
export function AreaChart({ values, className }: ChartProps): ReactNode {
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = values.length > 1 ? (WIDTH - 2 * PAD) / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(PAD + i * step).toFixed(1)},${(HEIGHT - PAD - ((v - low) / span) * (HEIGHT - 2 * PAD)).toFixed(1)}`);
  const last = points[points.length - 1];
  const area = `${PAD},${HEIGHT} ${points.join(" ")} ${last?.split(",")[0]},${HEIGHT}`;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={className} role="img" aria-label="Cumulative cost">
      <polygon points={area} fill="currentColor" opacity={0.15} />
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

/** One bar per value, scaled to the largest; `highlight` is the index drawn in the accent colour. */
export function BarChart({ values, highlight, className }: ChartProps & { highlight?: number }): ReactNode {
  if (values.length === 0) return null;
  const peak = Math.max(...values) || 1;
  const slot = (WIDTH - 2 * PAD) / values.length;
  const width = Math.max(1, slot * 0.7);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={className} role="img" aria-label="Cost per call">
      {values.map((v, i) => {
        const h = Math.max(1, (v / peak) * (HEIGHT - 2 * PAD));
        return (
          <rect
            key={i}
            x={PAD + i * slot}
            y={HEIGHT - PAD - h}
            width={width}
            height={h}
            fill="currentColor"
            opacity={i === highlight ? 1 : 0.55}
          />
        );
      })}
    </svg>
  );
}
