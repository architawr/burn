import { visibleWidth } from "@earendil-works/pi-tui";
import { budgetFraction, budgetState } from "../../src/budget.js";
import {
  cumulative,
  formatBudget,
  formatClock,
  formatDelta,
  formatDuration,
  formatTokens,
  formatUsd,
  isTokenOnly,
  median,
  modelName,
  providerName,
  sparkline,
  usageLabel,
} from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import {
  bar,
  blockChart,
  buckets,
  fit,
  flow,
  indent,
  joinFitting,
  KINDS,
  meter,
  pad,
  plural,
  spread,
  stacked,
  stateColor,
  type ViewInput,
} from "./draw.js";

/** Below this panel width the overview collapses to its essentials. */
const COMPACT_WIDTH = 60;
const GAP = "      ";
const SIDE_WIDTH = 24;
const LEGEND_CELL = 32;
const OVERVIEW_MODELS = 4;

const allTokens = (r: UsageReport): number => r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;

/** Dollars, or tokens for sessions that report no cost. */
const amount = (r: UsageReport) => (n: number): string => (isTokenOnly(r) ? `${formatTokens(n)} tok` : formatUsd(n));

function headline({ report, budget, theme }: ViewInput, sep: string, width: number, short: boolean): string {
  const dim = (t: string) => theme.fg("dim", t);
  const tokenOnly = isTokenOnly(report);
  const tone = stateColor(budgetState(report.cost.total, budget), "text");
  const parts = [theme.bold(theme.fg(tone, usageLabel(report))) + dim(tokenOnly ? " used" : " spent")];
  if (!tokenOnly && report.turnCount > 0) {
    const delta = formatDelta(report.lastTurnCost);
    if (report.running) parts.push(theme.bold(theme.fg("accent", `${delta}…`)) + dim(short ? " now" : " this turn"));
    else parts.push(theme.bold(theme.fg("success", delta)) + dim(short ? " last" : " last turn"));
    if (!short && report.calls > 0) parts.push(theme.bold(formatUsd(report.cost.total / report.calls)) + dim(" per call"));
  }
  return joinFitting(parts, width, sep);
}

const meta = (r: UsageReport): string =>
  r.calls === 0
    ? "No model calls yet"
    : `${plural(r.calls, "call")} · ${plural(r.turnCount, "prompt")} · ${formatDuration(r.updatedAt - r.startedAt)}`;

function budgetPart({ report, budget, theme }: ViewInput, barWidth: number, short: boolean): string {
  if (budget === null) return theme.fg("dim", short ? "No budget · /burn budget 10" : "No budget · /burn budget 10 sets one");
  const fraction = budgetFraction(report.cost.total, budget) ?? 0;
  const state = budgetState(report.cost.total, budget);
  const color = stateColor(state, "success");
  const percent = `${Math.round(fraction * 100)}%${state === "over" ? " ▲" : ""}`;
  return (
    theme.fg("dim", `budget ${formatBudget(budget)} `) +
    meter(theme, Math.min(1, fraction), barWidth, color) +
    theme.fg(state === "ok" ? "dim" : color, ` ${percent}`)
  );
}

function stoppedLine({ report, budget, theme }: ViewInput): string[] {
  if (report.stoppedAt === null) return [];
  const amountText = budget === null ? "the budget" : `the ${formatBudget(budget)} budget`;
  const latest = report.turns[report.turns.length - 1];
  const waiting = !report.running && (latest === undefined || latest.at <= report.stoppedAt);
  return [
    theme.fg("warning", `■ Stopped at ${amountText} at ${formatClock(report.stoppedAt)}`) +
      (waiting ? theme.fg("dim", " · send a prompt to keep going") : ""),
  ];
}

function metaLines(input: ViewInput, width: number): string[] {
  const { theme } = input;
  const text = theme.fg("dim", meta(input.report));
  const inline = `${text}${theme.fg("dim", " · ")}${budgetPart(input, 23, false)}`;
  if (visibleWidth(inline) <= width) return [inline];
  return [text, budgetPart(input, Math.max(6, Math.min(23, width - 22)), false)];
}

function kindRows(report: UsageReport) {
  const tokenOnly = isTokenOnly(report);
  const rows = KINDS.map((k) => ({ ...k, tokens: report.tokens[k.key], cost: report.cost[k.key] }));
  const size = (r: (typeof rows)[number]) => (tokenOnly ? r.tokens : r.cost);
  const total = rows.reduce((sum, r) => sum + size(r), 0);
  return rows.map((r) => ({ ...r, value: size(r), share: total > 0 ? size(r) / total : 0 }));
}

function whereLines({ report, theme }: ViewInput, width: number): string[] {
  const tokenOnly = isTokenOnly(report);
  const rows = kindRows(report);
  const cell = (r: (typeof rows)[number]) =>
    theme.fg(r.color, "■ ") +
    r.label.padEnd(12) +
    theme.fg("dim", formatTokens(r.tokens).padStart(5)) +
    (tokenOnly ? "        " : theme.bold(formatUsd(r.cost).padStart(8))) +
    theme.fg("dim", `${Math.round(r.share * 100)}%`.padStart(5));
  const lines = [theme.bold("Where it went"), stacked(theme, rows, width)];
  const twoColumns = width >= LEGEND_CELL * 2 + 6;
  if (twoColumns) {
    lines.push(cell(rows[0]!) + GAP + cell(rows[2]!), cell(rows[1]!) + GAP + cell(rows[3]!));
  } else {
    lines.push(...rows.map(cell));
  }
  if (report.tokens.reasoning > 0) {
    const note = theme.fg("dim", `output includes ${formatTokens(report.tokens.reasoning)} reasoning`);
    lines.push(twoColumns ? " ".repeat(LEGEND_CELL + GAP.length) + note : note);
  }
  return lines.map((l) => fit(l, width));
}

function axisLine(turns: readonly number[], spans: { from: number; to: number }[], cell: number): string {
  const chars = Array.from({ length: spans.length * cell }, () => "─");
  let free = 0;
  spans.forEach(({ from, to }, j) => {
    let label: number | null = null;
    for (let i = from; i < to; i++) {
      if (i === 0 || turns[i] !== turns[i - 1]) {
        label = turns[i] as number;
        break;
      }
    }
    const at = j * cell;
    const text = label === null ? "" : String(label);
    if (text === "" || at < free || at + text.length > chars.length) return;
    for (let k = 0; k < text.length; k++) chars[at + k] = text[k] as string;
    free = at + text.length + 1;
  });
  return chars.join("");
}

function spendLines({ report, theme }: ViewInput, width: number): string[] {
  const { series } = report;
  if (series.length === 0) return [];
  const tokenOnly = isTokenOnly(report);
  const money = amount(report);
  const dim = (t: string) => theme.fg("dim", t);
  const values = series.map((p) => (tokenOnly ? p.tokens : p.cost));
  const beside = width - SIDE_WIDTH - 3 >= 24;
  const room = beside ? width - SIDE_WIDTH - 3 : width;
  const step = Math.max(1, Math.min(4, Math.floor(room / values.length)));
  const spans = buckets(values, Math.max(1, Math.floor(room / step)));
  const sumShown = values.reduce((a, b) => a + b, 0);
  const cum = cumulative(values, (tokenOnly ? allTokens(report) : report.cost.total) - sumShown);
  const top = cum[cum.length - 1] as number;
  const peak = Math.max(...values);
  const priciest = values.indexOf(peak);
  const last = values.length - 1;
  const colorOf = (j: number) => {
    const s = spans[j]!;
    if (priciest >= s.from && priciest < s.to) return "warning";
    return last >= s.from && last < s.to ? "accent" : "success";
  };
  const cumRows = blockChart(
    theme,
    spans.map((s) => cum[s.to - 1] as number),
    { rows: 3, peak: top, cell: step, gap: 0, colorOf: () => "mdLink" },
  );
  const callRows = blockChart(
    theme,
    spans.map((s) => s.value),
    { rows: 2, peak, cell: Math.max(1, step - 1), gap: step > 1 ? 1 : 0, colorOf },
  );
  const chartWidth = spans.length * step;
  const axis = axisLine(
    series.map((p) => p.turn),
    spans,
    step,
  );
  const side = [
    dim(money(top)),
    dim("priciest ") + theme.bold(theme.fg("warning", money(peak))) + dim(` · turn ${series[priciest]!.turn}`),
    dim("median   ") + theme.bold(money(median(values) ?? 0)),
    dim("last     ") + theme.bold(theme.fg("accent", money(values[last] as number))),
  ];
  const legend = `${dim("cumulative ")}${theme.fg("mdLink", "■")}${dim("  per call ")}${theme.fg("success", "■")}`;
  const lines = [spread(theme.bold("Spend over time"), legend, width)];
  const chart = [...cumRows, ...callRows];
  if (beside) {
    chart.forEach((row, r) => lines.push(fit(pad(row, chartWidth) + (side[r] ? `   ${side[r]}` : ""), width)));
  } else {
    lines.push(...chart);
  }
  lines.push(fit(dim(axis) + (chartWidth + 5 <= width ? dim(" turn") : ""), width));
  lines.push(spread(dim(formatClock(series[0]!.at)), dim(formatClock(series[last]!.at)), chartWidth));
  if (!beside) lines.push(...flow(side.slice(1), width, "   "));
  return lines;
}

/** Models with a share bar; `limit` rows, then a pointer to the Models view. */
function modelTable({ report, theme }: ViewInput, width: number, limit: number): string[] {
  const rows = report.byModel;
  if (rows.length === 0) return [];
  const money = amount(report);
  const total = rows.reduce((sum, r) => sum + (isTokenOnly(report) ? r.tokens : r.cost), 0);
  const nameWidth = Math.min(24, Math.max(5, ...rows.map((r) => modelName(r.key).length)));
  let providerWidth = Math.min(14, Math.max(0, ...rows.map((r) => providerName(r.key).length)));
  const fixed = () => nameWidth + 2 + (providerWidth > 0 ? providerWidth + 2 : 0) + 5 + 2 + 9 + 3 + 5;
  if (width - fixed() < 6) providerWidth = 0;
  const shareWidth = Math.max(0, Math.min(16, width - fixed()));
  const provider = (key: string) => (providerWidth > 0 ? `${pad(theme.fg("dim", providerName(key)), providerWidth)}  ` : "");
  const head =
    pad(theme.bold("Models"), nameWidth + 2 + (providerWidth > 0 ? providerWidth + 2 : 0)) +
    pad(theme.fg("dim", "calls"), 5, "right") +
    "  " +
    pad(theme.fg("dim", "cost"), 9, "right") +
    (shareWidth >= 4 ? `   ${theme.fg("dim", "share")}` : "");
  const lines = [head];
  for (const r of rows.slice(0, limit)) {
    const value = isTokenOnly(report) ? r.tokens : r.cost;
    const share = total > 0 ? value / total : 0;
    lines.push(
      pad(modelName(r.key), nameWidth) +
        "  " +
        provider(r.key) +
        pad(r.calls > 0 ? String(r.calls) : theme.fg("dim", "–"), 5, "right") +
        "  " +
        pad(theme.bold(money(value)), 9, "right") +
        (shareWidth >= 4 ? `   ${bar(theme, share, shareWidth, "accent")}${theme.fg("dim", `${Math.round(share * 100)}%`.padStart(5))}` : ""),
    );
  }
  if (rows.length > limit) lines.push(theme.fg("dim", `+${rows.length - limit} more on the Models view (3)`));
  return lines.map((l) => fit(l, width));
}

function contextPart({ report, theme }: ViewInput, barWidth: number): string | null {
  const ctx = report.context;
  if (!ctx) return null;
  if (ctx.percent === null || ctx.tokens === null) {
    return theme.fg("dim", `Context unknown until the next reply (window ${formatTokens(ctx.window)})`);
  }
  const color = ctx.percent > 90 ? "error" : ctx.percent > 70 ? "warning" : "accent";
  return (
    theme.fg("dim", "Context ") +
    `${formatTokens(ctx.tokens)} / ${formatTokens(ctx.window)} ` +
    meter(theme, ctx.percent / 100, barWidth, color) +
    theme.fg("dim", ` ${Math.round(ctx.percent)}%`)
  );
}

function footer(input: ViewInput, width: number): string[] {
  const { report, theme } = input;
  const parts: string[] = [];
  if (report.cacheHitPct !== null) parts.push(theme.fg("dim", "Cache ") + theme.fg("success", `${report.cacheHitPct.toFixed(0)}% hit`));
  const ctx = contextPart(input, 12);
  if (ctx) parts.push(ctx);
  return flow(parts, width, GAP);
}

function fullOverview(input: ViewInput): string[] {
  const width = input.width - 4;
  const { report } = input;
  const lines = ["", headline(input, GAP, width, false), ...metaLines(input, width), ...stoppedLine(input)];
  if (report.calls > 0 || report.cost.total > 0) {
    lines.push("", ...whereLines(input, width));
    const spend = spendLines(input, width);
    if (spend.length > 0) lines.push("", ...spend);
    const models = modelTable(input, width, OVERVIEW_MODELS);
    if (models.length > 0) lines.push("", ...models);
  }
  const end = footer(input, width);
  if (end.length > 0) lines.push("", ...end);
  lines.push("");
  return indent(lines, 2).map((l) => fit(l, input.width));
}

function compactOverview(input: ViewInput): string[] {
  const { report, theme } = input;
  const width = input.width - 2;
  const lines = [
    headline(input, theme.fg("dim", " · "), width, true),
    fit(theme.fg("dim", meta(report)), width),
    fit(budgetPart(input, Math.max(4, Math.min(12, width - 24)), true), width),
    ...stoppedLine(input).map((l) => fit(l, width)),
  ];
  if (report.calls > 0 || report.cost.total > 0) {
    const rows = kindRows(report);
    const money = amount(report);
    lines.push(stacked(theme, rows, width));
    lines.push(...flow(rows.map((r) => `${theme.fg(r.color, "■")} ${r.short} ${money(r.value)}`), width, " "));
    if (report.series.length > 0) {
      const values = report.series.map((p) => (isTokenOnly(report) ? p.tokens : p.cost));
      const base = (isTokenOnly(report) ? allTokens(report) : report.cost.total) - values.reduce((a, b) => a + b, 0);
      const total = money(isTokenOnly(report) ? allTokens(report) : report.cost.total);
      const spark = sparkline(cumulative(values, base), Math.max(1, width - total.length - 1));
      lines.push(`${theme.fg("mdLink", spark)} ${theme.fg("dim", total)}`);
    }
    const total = report.byModel.reduce((sum, m) => sum + (isTokenOnly(report) ? m.tokens : m.cost), 0);
    const models = report.byModel.map((m) => {
      const value = isTokenOnly(report) ? m.tokens : m.cost;
      const share = total > 0 ? ` ${theme.fg("dim", `${Math.round((value / total) * 100)}%`)}` : "";
      return `${modelName(m.key)} ${theme.bold(money(value))}${share}`;
    });
    lines.push(...flow(models, width, theme.fg("dim", " · ")).slice(0, 2));
  }
  lines.push(...footer(input, width).slice(0, 2));
  return indent(lines, 1).map((l) => fit(l, input.width));
}

export function overviewLines(input: ViewInput): string[] {
  return input.width + 2 < COMPACT_WIDTH ? compactOverview(input) : fullOverview(input);
}
