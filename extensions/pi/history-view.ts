import { homedir } from "node:os";
import { formatClock, formatUsd } from "../../src/format.js";
import { dayKey, type UsageReport } from "../../src/report.js";
import { blockChart, clip, fit, formatDay, indent, joinFitting, pad, plural, spread, type ViewInput } from "./draw.js";
import { RANGES, type RangeTotals, rangeTotals, type SessionSummary, summarise } from "./history.js";

export type HistoryData =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionSummary[] }
  | { status: "error"; message: string };

export interface HistorySource {
  cwd: string;
  /** The open session's file, which History marks and fills from the live report. */
  currentPath: string | null;
  currentTitle: string;
  now: number;
  data: HistoryData;
}

export interface HistoryState {
  range: number;
  /** The selected session's path; null selects the first. */
  selected: string | null;
  top: number;
}

const CHART_ROWS = 3;
const MIN_ROWS = 3;

const tilde = (path: string): string => {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

/** The sessions History lists, with the open one taken from the live report. */
function historySessions(source: HistorySource, report: UsageReport): SessionSummary[] {
  if (source.data.status !== "ready") return [];
  const { currentPath } = source;
  const loaded = source.data.sessions;
  if (currentPath === null) return loaded;
  const title = loaded.find((s) => s.path === currentPath)?.title ?? source.currentTitle;
  return [summarise(currentPath, title, report), ...loaded.filter((s) => s.path !== currentPath)];
}

export function historyTotals(source: HistorySource, report: UsageReport, range: number): RangeTotals {
  const r = RANGES[range] ?? RANGES[0];
  return rangeTotals(historySessions(source, report), r.days, r.chartDays, source.now);
}

export function historyIndex(totals: RangeTotals, selected: string | null): number {
  const index = selected === null ? 0 : totals.sessions.findIndex((s) => s.session.path === selected);
  return index === -1 ? 0 : index;
}

function chartLines(input: ViewInput, totals: RangeTotals, now: number): string[] {
  const { theme } = input;
  const width = input.width - 4;
  const days = totals.chart;
  const room = width - 10;
  const slot = Math.max(1, Math.min(days.length <= 7 ? 8 : 3, Math.floor(room / days.length)));
  const cell = days.length <= 7 ? Math.max(1, slot - 3) : Math.max(1, slot - 1);
  const gap = slot - cell;
  const peak = Math.max(0, ...days.map((d) => d.cost));
  const today = dayKey(now);
  const rows = blockChart(
    theme,
    days.map((d) => d.cost),
    { rows: CHART_ROWS, peak, cell, gap, colorOf: (i) => (days[i]?.day === today ? "accent" : "success") },
  );
  const chartWidth = days.length * slot;
  const label = (r: number) => (r === 0 ? theme.fg("dim", formatUsd(peak)) : r === CHART_ROWS - 1 ? theme.fg("dim", "$0") : "");
  const lines = rows.map((row, r) => `${pad(row, chartWidth)}  ${label(r)}`);
  const date = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y as number, (m as number) - 1, d as number, 12);
  };
  if (days.length <= 7) {
    lines.push(
      theme.fg("dim", days.map((d) => pad(date(d.day).toLocaleDateString("en-US", { weekday: "short" }), slot)).join("")),
    );
  } else {
    lines.push(spread(theme.fg("dim", formatDay(date(days[0]!.day).getTime())), theme.fg("dim", "today"), chartWidth));
  }
  return lines.map((l) => fit(l, width));
}

/** The History view, at most `height` lines; returns the first visible row to keep. */
export function historyView(
  input: ViewInput & { height: number; state: HistoryState; source: HistorySource },
): { lines: string[]; top: number } {
  const { theme, report, source, state, height } = input;
  const width = input.width - 4;
  const dim = (t: string) => theme.fg("dim", t);
  const range = RANGES[state.range] ?? RANGES[0];
  const tabs = RANGES.map((r, i) =>
    i === state.range ? theme.inverse(theme.bold(theme.fg("accent", ` ${r.label} `))) : dim(` ${r.label} `),
  ).join("");
  const project = `${theme.bold("This project")}${dim(` · ${tilde(source.cwd)}`)}`;
  const head = ["", spread(project, tabs, width).endsWith(tabs) ? spread(project, tabs, width) : tabs, ""];
  if (source.data.status === "loading") return { lines: indent([...head, dim("Loading sessions…")], 2), top: 0 };
  if (source.data.status === "error") {
    return { lines: indent([...head, fit(theme.fg("error", `Could not read this project's sessions: ${source.data.message}`), width)], 2), top: 0 };
  }
  const totals = historyTotals(source, report, state.range);
  const week = state.range === 0 ? historyTotals(source, report, 1).cost : null;
  const headline = joinFitting(
    [
      theme.bold(formatUsd(totals.cost)) + dim(` ${range.title}`),
      week !== null ? theme.bold(formatUsd(week)) + dim(" last 7 days") : theme.bold(formatUsd(totals.cost / range.days)) + dim(" per day"),
      dim(`${plural(totals.sessions.length, "session")} · ${plural(totals.calls, "call")}`),
    ],
    width,
    "      ",
  );
  const top = [...head, headline, "", ...chartLines(input, totals, source.now), ""];
  if (totals.sessions.length === 0) {
    return { lines: indent([...top, dim(`No sessions with spend ${range.title}.`)], 2).map((l) => fit(l, input.width)), top: 0 };
  }
  const titleWidth = Math.max(8, width - 4 - 8 - 7 - 9);
  const header =
    pad(theme.bold(`Sessions ${range.title}`), titleWidth + 4) +
    pad(dim("started"), 8, "right") +
    pad(dim("calls"), 7, "right") +
    pad(dim("cost"), 9, "right");
  const index = historyIndex(totals, state.selected);
  const shown = Math.min(totals.sessions.length, Math.max(MIN_ROWS, height - top.length - 1));
  let first = Math.max(0, Math.min(state.top, totals.sessions.length - shown));
  if (index < first) first = index;
  if (index >= first + shown) first = index - shown + 1;
  const today = dayKey(source.now);
  const rows = totals.sessions.slice(first, first + shown).map(({ session, cost, calls }, i) => {
    const selected = first + i === index;
    const current = session.path === source.currentPath;
    const started = dayKey(session.startedAt) === today ? formatClock(session.startedAt) : formatDay(session.startedAt);
    const title = clip(session.title, titleWidth);
    const line =
      (selected ? theme.fg("accent", "▸ ") : "  ") +
      (current ? theme.fg("success", "● ") : "  ") +
      pad(selected || current ? theme.bold(title) : title, titleWidth) +
      pad(dim(started), 8, "right") +
      pad(dim(String(calls)), 7, "right") +
      pad(theme.bold(formatUsd(cost)), 9, "right");
    return selected ? theme.bg("selectedBg", line) : line;
  });
  const lines = indent([...top, header, ...rows], 2).slice(0, Math.max(height, top.length + 1 + shown));
  return { lines: lines.map((l) => fit(l, input.width)), top: first };
}
