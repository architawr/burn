import type { UsageReport } from "./report.js";

const BARS = "▁▂▃▄▅▆▇█";

export const formatUsd = (n: number): string => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** A cost change since the last user message: "+$0.31", or "<$0.01" when it rounds to nothing. */
export const formatDelta = (n: number): string => (n < 0.005 ? "<$0.01" : `+${formatUsd(n)}`);

/** The same rules as pi's footer, so the figures read alike. */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** One cell per bucket (its maximum), scaled to the overall maximum. */
export function sparkline(values: number[], width: number): string {
  if (values.length === 0 || width < 1) return "";
  const cells = Math.min(width, values.length);
  const buckets: number[] = [];
  for (let i = 0; i < cells; i++) {
    const from = Math.floor((i * values.length) / cells);
    const to = Math.floor(((i + 1) * values.length) / cells);
    buckets.push(Math.max(...values.slice(from, to)));
  }
  const peak = Math.max(...buckets);
  return buckets.map((v) => BARS[peak > 0 ? Math.min(7, Math.floor((v / peak) * 7)) : 0]).join("");
}

export function cumulative(costs: number[], base: number): number[] {
  let sum = base;
  return costs.map((c) => (sum += c));
}

/** The pill's text: dollars, or total tokens when the provider reports no cost for a session that used some. */
export function usageLabel(report: UsageReport): string {
  const t = report.tokens;
  const tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
  return report.cost.total > 0 || tokens === 0 ? formatUsd(report.cost.total) : `${formatTokens(tokens)} tok`;
}
