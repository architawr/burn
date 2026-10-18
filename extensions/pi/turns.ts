import { formatClock, formatDuration, formatTokens, formatUsd, modelName, turnMultiple } from "../../src/format.js";
import type { TurnRow } from "../../src/report.js";
import { BLOCKS, clip, fit, flow, indent, type PanelTheme, pad, plural, spread, type ViewInput, wrap } from "./draw.js";

export interface TurnsState {
  /** The selected turn's number; null selects the newest. */
  selected: number | null;
  expanded: boolean;
  /** The first visible row. */
  top: number;
}

interface Column {
  key: string;
  title: string;
  width: number;
  align: "left" | "right";
}

const BAR_WIDTH = 10;
const PROMPT_MIN = 14;
const MIN_ROWS = 3;

/** Newest first, the order the view lists them in. */
export const turnList = (turns: readonly TurnRow[]): TurnRow[] => [...turns].reverse();

export function selectedIndex(list: readonly TurnRow[], selected: number | null): number {
  const index = selected === null ? 0 : list.findIndex((t) => t.n === selected);
  return index === -1 ? 0 : index;
}

const toolCount = (t: TurnRow): number => t.tools.reduce((sum, tool) => sum + tool.count, 0);

function columns(width: number): Column[] {
  const all: (Column & { drop: number })[] = [
    { key: "n", title: "#", width: 3, align: "right", drop: 0 },
    { key: "time", title: "time", width: 5, align: "left", drop: 3 },
    { key: "prompt", title: "prompt", width: 0, align: "left", drop: 0 },
    { key: "calls", title: "calls", width: 5, align: "right", drop: 0 },
    { key: "tools", title: "tools", width: 5, align: "right", drop: 2 },
    { key: "cost", title: "cost", width: 7, align: "right", drop: 0 },
    { key: "bar", title: "", width: BAR_WIDTH, align: "left", drop: 1 },
  ];
  let cols = all;
  const room = (list: Column[]) => width - 2 - list.reduce((sum, c) => sum + c.width + 1, 0);
  for (const level of [1, 2, 3]) {
    if (room(cols) >= PROMPT_MIN) break;
    cols = cols.filter((c) => c.drop !== level);
  }
  const prompt = cols.find((c) => c.key === "prompt") as Column;
  prompt.width = Math.max(4, room(cols) + prompt.width);
  return cols;
}

function promptText(t: TurnRow): string {
  if (t.prompt !== "") return t.prompt;
  return t.n === 0 ? "(before the first prompt)" : "(no text)";
}

function cells(input: ViewInput, t: TurnRow, peak: number): Record<string, string> {
  const { theme, report } = input;
  const multiple = turnMultiple(t, report.turns);
  const filled = peak > 0 ? Math.max(1, Math.round((t.cost / peak) * BAR_WIDTH)) : 0;
  return {
    n: theme.fg("dim", String(t.n)),
    time: theme.fg("dim", formatClock(t.at)),
    prompt: promptText(t),
    calls: theme.fg("dim", String(t.calls)),
    tools: theme.fg("dim", String(toolCount(t))),
    cost: theme.bold(formatUsd(t.cost)),
    bar: theme.fg(multiple !== null && multiple >= 2 ? "warning" : "success", "█".repeat(filled)),
  };
}

function row(theme: PanelTheme, cols: Column[], values: Record<string, string>, selected: boolean): string {
  const marker = selected ? theme.fg("accent", "▸ ") : "  ";
  const parts = cols.map((c) => {
    const value = c.key === "prompt" ? clip(values.prompt ?? "", c.width) : (values[c.key] ?? "");
    return pad(selected && c.key === "prompt" ? theme.bold(value) : value, c.width, c.align);
  });
  const line = marker + parts.join(" ");
  return selected ? theme.bg("selectedBg", line) : line;
}

/** The expanded turn: its span and multiple, prompt, tokens, per-call bars and tools. */
function turnDetail(input: ViewInput, t: TurnRow): string[] {
  const { theme, report } = input;
  const width = input.width - 4;
  const dim = (text: string) => theme.fg("dim", text);
  const multiple = turnMultiple(t, report.turns);
  const head = [
    theme.bold(`Turn ${t.n}`),
    dim(`${formatClock(t.at)} → ${formatClock(t.endAt)} (${formatDuration(t.endAt - t.at)})`),
    dim(plural(t.calls, "call")),
    dim(plural(toolCount(t), "tool")),
  ];
  if (multiple !== null) head.push(theme.fg(multiple >= 2 ? "warning" : "dim", `${multiple.toFixed(1)}× median turn`));
  const lines = flow(head, width, dim(" · "));
  if (t.prompt !== "") lines.push(...wrap(`“${t.prompt}”`, width, 2).map((l) => theme.italic(dim(l))));
  lines.push("");
  const names = t.models.map(modelName);
  const models = names.length === 1 ? `${names[0]} ×${t.calls}` : names.join(", ");
  const tokens = [
    `${dim("in ")}${formatTokens(t.tokens.input)}`,
    `${dim("cache ")}${theme.fg("success", formatTokens(t.tokens.cacheRead))}`,
    `${dim("write ")}${theme.fg("warning", formatTokens(t.tokens.cacheWrite))}`,
    `${dim("out ")}${theme.fg("mdLink", formatTokens(t.tokens.output))}`,
  ].join("  ");
  const cost = theme.bold(formatUsd(t.cost));
  const oneLine = spread(models === "" ? tokens : `${models}    ${tokens}`, cost, width);
  if (oneLine.endsWith(cost)) lines.push(oneLine);
  else lines.push(...(models === "" ? [] : [fit(models, width)]), spread(tokens, cost, width));
  if (t.callCosts.length > 0) {
    const peak = Math.max(...t.callCosts);
    const priciest = t.callCosts.indexOf(peak);
    const bars = t.callCosts
      .map((c, i) => theme.fg(i === priciest ? "warning" : "success", BLOCKS[peak > 0 ? Math.max(1, Math.round((c / peak) * 8)) : 1] as string))
      .join(" ");
    const label = t.calls > t.callCosts.length ? `last ${t.callCosts.length} ` : "calls  ";
    lines.push(fit(`${dim(label)}${bars}  ${dim(t.callCosts.map(formatUsd).join(" "))}`, width));
  }
  const tools = t.tools.length > 0 ? t.tools.map((tool) => `${tool.name} ×${tool.count}`).join(" · ") : dim("none");
  lines.push(fit(`${dim("tools  ")}${tools}`, width));
  return indent(lines, 2);
}

/** The Turns view, at most `height` lines; returns the first visible row to keep for the next render. */
export function turnsView(input: ViewInput & { height: number; state: TurnsState }): { lines: string[]; top: number } {
  const { theme, report, height, state } = input;
  const list = turnList(report.turns);
  if (list.length === 0) {
    return { lines: ["", `  ${theme.fg("dim", "No prompts yet. Each prompt shows here with what it cost.")}`], top: 0 };
  }
  const cols = columns(input.width);
  const header = theme.fg("dim", `  ${cols.map((c) => pad(c.title, c.width, c.align)).join(" ")}`.trimEnd());
  const index = selectedIndex(list, state.selected);
  const detail = state.expanded ? ["", theme.fg("borderMuted", `  ${"─".repeat(Math.max(0, input.width - 4))}`), ...turnDetail(input, list[index]!)] : [];
  const fixed = 2;
  const shown = Math.min(list.length, Math.max(Math.min(MIN_ROWS, list.length), height - fixed - detail.length));
  let top = Math.max(0, Math.min(state.top, list.length - shown));
  if (index < top) top = index;
  if (index >= top + shown) top = index - shown + 1;
  const peak = Math.max(...list.map((t) => t.cost));
  const rows = list.slice(top, top + shown).map((t, i) => row(theme, cols, cells(input, t, peak), top + i === index));
  const lines = ["", header, ...rows, ...detail].slice(0, Math.max(height, fixed + shown));
  return { lines: lines.map((l) => fit(l, input.width)), top };
}
