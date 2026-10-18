import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { cumulative, formatDelta, formatTokens, formatUsd, sparkline } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";

export interface PanelTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

const BAR_WIDTH = 30;
const SPARK_WIDTH = 24;
const LABEL_WIDTH = 20;

const bar = (fraction: number, width: number): string => {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
};

const since = (ms: number): string =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const row = (label: string, tokens: string, cost: string, extra = ""): string =>
  `  ${label.padEnd(LABEL_WIDTH)} ${tokens.padStart(8)} ${cost.padStart(8)} ${extra}`.trimEnd();

function contextLines(report: UsageReport, theme: PanelTheme): string[] {
  const ctx = report.context;
  if (!ctx) return [];
  const head = theme.fg("dim", "Context");
  if (ctx.percent == null || ctx.tokens == null) {
    return [`${head}  unknown until the next reply (window ${formatTokens(ctx.window)})`, ""];
  }
  const color = ctx.percent > 90 ? "error" : ctx.percent > 70 ? "warning" : "accent";
  return [
    `${head}  ${formatTokens(ctx.tokens)} / ${formatTokens(ctx.window)} (${ctx.percent.toFixed(1)}%)`,
    theme.fg(color, bar(ctx.percent / 100, BAR_WIDTH)),
    "",
  ];
}

function kindLines(report: UsageReport, theme: PanelTheme): string[] {
  const { cost, tokens } = report;
  const kinds: [string, number, number, string][] = [
    ["input (uncached)", tokens.input, cost.input, "accent"],
    ["cache read", tokens.cacheRead, cost.cacheRead, "success"],
    ["cache write", tokens.cacheWrite, cost.cacheWrite, "warning"],
    ["output", tokens.output, cost.output, "mdLink"],
  ];
  const lines = [theme.fg("dim", "Cost by token type")];
  for (const [label, count, spent, color] of kinds) {
    const share = cost.total > 0 ? spent / cost.total : 0;
    lines.push(row(label, formatTokens(count), formatUsd(spent), theme.fg(color, bar(share, 16))));
  }
  if (tokens.reasoning > 0) lines.push(theme.fg("dim", `  output includes ${formatTokens(tokens.reasoning)} reasoning`));
  return [...lines, ""];
}

function modelLines(report: UsageReport, theme: PanelTheme): string[] {
  if (report.byModel.length === 0) return [];
  const lines = [theme.fg("dim", "By model")];
  for (const m of report.byModel) lines.push(row(m.key, `${m.calls} calls`, formatUsd(m.cost)));
  return [...lines, ""];
}

function chartLines(report: UsageReport, theme: PanelTheme): string[] {
  if (report.series.length === 0) return [];
  const costs = report.series.map((p) => p.cost);
  const base = report.cost.total - costs.reduce((a, b) => a + b, 0);
  return [
    `${theme.fg("dim", "Cumulative cost".padEnd(LABEL_WIDTH))} ${theme.fg("mdLink", sparkline(cumulative(costs, base), SPARK_WIDTH))}`,
    `${theme.fg("dim", "Cost per call".padEnd(LABEL_WIDTH))} ${theme.fg("success", sparkline(costs, SPARK_WIDTH))}`,
    "",
  ];
}

export function panelLines(report: UsageReport, theme: PanelTheme, width: number | null): string[] {
  const lines: string[] = [];
  if (report.calls === 0) {
    lines.push(theme.bold("Thread usage"), "No model calls yet.");
  } else {
    const perCall = formatUsd(report.cost.total / report.calls);
    lines.push(
      theme.bold(`Thread usage · ${report.calls} calls · since ${since(report.startedAt)}`),
      `${theme.bold(formatUsd(report.cost.total))} total · last turn ${formatDelta(report.lastTurnCost)} · ${perCall} per call`,
      "",
      ...contextLines(report, theme),
      ...kindLines(report, theme),
      ...modelLines(report, theme),
      ...chartLines(report, theme),
    );
    if (report.cacheHitPct != null) lines.push(`cache hit (session) ${report.cacheHitPct.toFixed(1)}%`);
  }
  lines.push(theme.fg("dim", "esc close"));
  return width === null ? lines : lines.map((line) => truncateToWidth(line, width, "…"));
}

export class BurnPanel {
  private cached: { width: number; lines: string[] } | null = null;

  constructor(
    private readonly report: UsageReport,
    private readonly theme: PanelTheme,
    private readonly onClose: () => void,
  ) {}

  render(width: number): string[] {
    if (this.cached?.width === width) return this.cached.lines;
    const lines = panelLines(this.report, this.theme, width);
    this.cached = { width, lines };
    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") this.onClose();
  }

  invalidate(): void {
    this.cached = null;
  }
}
