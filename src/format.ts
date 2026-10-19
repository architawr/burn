import { OTHER_KEY, TOOLS_KEY, type TurnRow, type UsageReport } from "./report.js";

const BARS = "▁▂▃▄▅▆▇█";

export const formatUsd = (n: number): string => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** Dollars, with a tilde when the amount is a list-price estimate: "~$1.23". */
export const formatAmount = (n: number, estimated: boolean): string => `${estimated ? "~" : ""}${formatUsd(n)}`;

/** A report's total cost, marked when it is an estimate. */
export const formatCost = (report: UsageReport): string => formatAmount(report.cost.total, report.estimated);

/** A cost change since the last user message: "+$0.31", or "<$0.01" when it rounds to nothing. */
export const formatDelta = (n: number): string => (n < 0.005 ? "<$0.01" : `+${formatUsd(n)}`);

/** A budget amount: "$10" for whole dollars, "$7.50" otherwise. */
export const formatBudget = (n: number): string => (Number.isInteger(n) ? `$${n}` : formatUsd(n));

/** The same rules as pi's footer, so the figures read alike. */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** For totals across threads, which pass a billion; formatTokens keeps pi's footer rules. */
export const formatTokenCount = (n: number): string => (n < 1e9 ? formatTokens(n) : `${(n / 1e9).toFixed(n < 1e10 ? 2 : 1)}B`);

/** How long a model call took: "6.8s" under ten seconds, else "27s" or "1m 05s". */
export const formatCallTime = (ms: number): string => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms));

/** "18s", "1m 02s", "1h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** How long ago, compact: "12s", "4m", "3h", "2d". */
export function formatAgo(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** "Oct 18, 12:01 PM". */
export const formatSince = (ms: number): string =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** "12:01", local time. */
export const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A byModel key for people: "anthropic/claude-opus-4-5" reads "claude-opus-4-5". */
export function modelName(key: string): string {
  if (key === TOOLS_KEY) return "Tools and summaries";
  if (key === OTHER_KEY) return OTHER_KEY;
  const slash = key.indexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/** The provider part of a byModel key, or "" for Burn's own rows. */
export function providerName(key: string): string {
  if (key === TOOLS_KEY || key === OTHER_KEY) return "";
  const slash = key.indexOf("/");
  return slash === -1 ? "" : key.slice(0, slash);
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

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The pill's text: dollars, or total tokens when the provider reports no cost for a session that used some. */
export function usageLabel(report: UsageReport): string {
  const t = report.tokens;
  const tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
  return report.cost.total > 0 || tokens === 0 ? formatCost(report) : `${formatTokens(tokens)} tok`;
}

/** True when the report has tokens but no cost, so labels show tokens. */
export function isTokenOnly(report: UsageReport): boolean {
  const t = report.tokens;
  return report.cost.total === 0 && t.input + t.output + t.cacheRead + t.cacheWrite > 0;
}

/** How many times the median of the other turns `turn` cost; null with fewer than three other turns. */
export function turnMultiple(turn: TurnRow, turns: readonly TurnRow[]): number | null {
  const others = turns.filter((t) => t !== turn && t.calls > 0).map((t) => t.cost);
  if (others.length < 3) return null;
  const mid = median(others);
  return mid !== null && mid > 0 ? turn.cost / mid : null;
}

/** A Markdown summary of the report for pasting into a PR, an issue or a chat. */
export function summaryMarkdown(report: UsageReport, opts: { title?: string; budget?: number | null } = {}): string {
  const lines: string[] = [];
  lines.push(`### ${opts.title ? `Cost of “${opts.title}”` : "Thread cost"}`);
  lines.push("");
  const spent = usageLabel(report);
  const budget = opts.budget ?? null;
  const share = budget !== null && budget > 0 ? ` of a ${formatBudget(budget)} budget (${Math.round((report.cost.total / budget) * 100)}%)` : "";
  const span = report.calls > 0 ? `, over ${formatDuration(report.updatedAt - report.startedAt)}` : "";
  lines.push(`**${spent}**${share} · ${report.calls} calls · ${report.turnCount} prompts${span}`);
  lines.push("");
  const { cost, tokens } = report;
  lines.push("| Token type | Tokens | Cost |", "| --- | ---: | ---: |");
  lines.push(`| Input | ${formatTokens(tokens.input)} | ${formatUsd(cost.input)} |`);
  lines.push(`| Cache read | ${formatTokens(tokens.cacheRead)} | ${formatUsd(cost.cacheRead)} |`);
  lines.push(`| Cache write | ${formatTokens(tokens.cacheWrite)} | ${formatUsd(cost.cacheWrite)} |`);
  lines.push(`| Output | ${formatTokens(tokens.output)} | ${formatUsd(cost.output)} |`);
  if (report.byModel.length > 0) {
    lines.push("", "| Model | Calls | Cost |", "| --- | ---: | ---: |");
    for (const m of report.byModel) lines.push(`| ${modelName(m.key)} | ${m.calls} | ${formatUsd(m.cost)} |`);
  }
  if (report.cacheHitPct !== null) lines.push("", `Cache hit rate ${report.cacheHitPct.toFixed(0)}%.`);
  return lines.join("\n");
}
