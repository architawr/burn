import { formatTokens, formatUsd, isTokenOnly, modelName, providerName } from "../../src/format.js";
import { TOOLS_KEY } from "../../src/report.js";
import { bar, fit, flow, formatDay, indent, pad, plural, type ViewInput } from "./draw.js";

interface Column {
  key: string;
  title: string;
  width: number;
  align: "left" | "right";
  drop: number;
}

const NAME_MIN = 12;
const DAYS_SHOWN = 14;

function columns(width: number, nameWidth: number, providerWidth: number): Column[] {
  let cols: Column[] = [
    { key: "name", title: "model", width: nameWidth, align: "left", drop: 0 },
    { key: "provider", title: "provider", width: Math.max(8, providerWidth), align: "left", drop: 3 },
    { key: "calls", title: "calls", width: 5, align: "right", drop: 0 },
    { key: "tokens", title: "tokens", width: 7, align: "right", drop: 2 },
    { key: "cost", title: "cost", width: 9, align: "right", drop: 0 },
    { key: "avg", title: "per call", width: 9, align: "right", drop: 4 },
    { key: "share", title: "share", width: 17, align: "left", drop: 1 },
  ];
  const used = (list: Column[]) => list.reduce((sum, c) => sum + c.width + 2, 0);
  for (const level of [1, 2, 3, 4]) {
    if (used(cols) <= width) break;
    cols = cols.filter((c) => c.drop !== level);
  }
  const name = cols[0] as Column;
  name.width = Math.max(NAME_MIN, Math.min(nameWidth, name.width + width - used(cols)));
  return cols;
}

const dayLabel = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return formatDay(new Date(y as number, (m as number) - 1, d as number).getTime());
};

/** The Models view: every model with tokens, cost, cost per call and share, then spend by day. */
export function modelsLines(input: ViewInput): string[] {
  const { report, theme } = input;
  const width = input.width - 4;
  const dim = (t: string) => theme.fg("dim", t);
  if (report.byModel.length === 0) return ["", `  ${dim("No model calls yet.")}`];
  const tokenOnly = isTokenOnly(report);
  const valueOf = (m: { cost: number; tokens: number }) => (tokenOnly ? m.tokens : m.cost);
  const total = report.byModel.reduce((sum, m) => sum + valueOf(m), 0);
  const nameWidth = Math.max(NAME_MIN, ...report.byModel.map((m) => modelName(m.key).length));
  const providerWidth = Math.max(0, ...report.byModel.map((m) => providerName(m.key).length));
  const cols = columns(width, nameWidth, providerWidth);
  const line = (cells: Record<string, string>) => cols.map((c) => pad(cells[c.key] ?? "", c.width, c.align)).join("  ");
  const lines = ["", dim(line(Object.fromEntries(cols.map((c) => [c.key, c.title]))))];
  for (const m of report.byModel) {
    const share = total > 0 ? valueOf(m) / total : 0;
    lines.push(
      line({
        name: modelName(m.key),
        provider: dim(providerName(m.key)),
        calls: m.calls > 0 ? String(m.calls) : dim("–"),
        tokens: dim(formatTokens(m.tokens)),
        cost: theme.bold(tokenOnly ? `${formatTokens(m.tokens)} tok` : formatUsd(m.cost)),
        avg: m.calls > 0 && !tokenOnly ? formatUsd(m.cost / m.calls) : dim("–"),
        share: `${bar(theme, share, 11, "accent")} ${dim(`${Math.round(share * 100)}%`.padStart(4))}`,
      }),
    );
  }
  lines.push("");
  const summary = [
    plural(report.calls, "call"),
    `${tokenOnly ? `${formatTokens(total)} tok` : formatUsd(report.cost.total)} total`,
    ...(report.cacheHitPct === null ? [] : [`cache hit ${report.cacheHitPct.toFixed(0)}%`]),
  ];
  lines.push(...flow(summary.map(dim), width, dim(" · ")));
  if (report.byModel.some((m) => m.key === TOOLS_KEY)) {
    lines.push(dim(fit(`${modelName(TOOLS_KEY)}: usage that tools and compaction summaries report themselves.`, width)));
  }
  if (report.days.length > 0) {
    lines.push("", theme.bold("By day"));
    for (const d of [...report.days].reverse().slice(0, DAYS_SHOWN)) {
      const head = `${pad(dayLabel(d.day), 7)} ${pad(theme.bold(formatUsd(d.cost)), 8, "right")} ${pad(dim(plural(d.calls, "call")), 10, "right")}`;
      const models = d.models.map((m) => `${modelName(m.key)} ${dim(formatUsd(m.cost))}`);
      if (width >= 64) lines.push(fit(`${head}   ${models.join(dim(" · "))}`, width));
      else lines.push(head, ...indent(flow(models, width - 2, dim(" · ")), 2));
    }
  }
  lines.push("");
  return indent(lines, 2).map((l) => fit(l, input.width));
}
