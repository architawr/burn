import { readFile, stat } from "node:fs/promises";
import { buildReport, type DayRow, dayKey, type EntryLike, type UsageReport } from "../../src/report.js";

export const HISTORY_DAYS = 30;
export const HISTORY_FILES = 200;
const DAY_MS = 86_400_000;

/** The parts of pi's SessionInfo History needs. */
export interface SessionFile {
  path: string;
  name?: string;
  firstMessage: string;
}

export interface SessionSummary {
  path: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  calls: number;
  cost: number;
  days: DayRow[];
}

export interface HistoryLoader {
  load(cwd: string): Promise<SessionSummary[]>;
}

export const sessionTitle = (file: { name?: string; firstMessage: string }): string =>
  file.name?.trim() || file.firstMessage.replace(/\s+/g, " ").trim() || "(no messages)";

export const summarise = (path: string, title: string, report: UsageReport): SessionSummary => ({
  path,
  title,
  startedAt: report.startedAt,
  updatedAt: report.updatedAt,
  calls: report.calls,
  cost: report.cost.total,
  days: report.days,
});

/**
 * Reads this project's session files modified in the last HISTORY_DAYS days (at
 * most HISTORY_FILES, newest first) and summarises each, cached by path and
 * modification time. A file that cannot be read or parsed is left out.
 */
export function createHistoryLoader(deps: {
  list: (cwd: string) => Promise<SessionFile[]>;
  parse: (text: string) => unknown[];
  now?: () => number;
}): HistoryLoader {
  const cache = new Map<string, { mtime: number; summary: SessionSummary }>();
  return {
    async load(cwd) {
      const now = (deps.now ?? Date.now)();
      const files = await deps.list(cwd);
      const stamped = await Promise.all(
        files.map(async (file) => ({ file, mtime: await stat(file.path).then((s) => s.mtimeMs, () => null) })),
      );
      const recent = stamped
        .filter((s): s is { file: SessionFile; mtime: number } => s.mtime !== null && now - s.mtime <= HISTORY_DAYS * DAY_MS)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, HISTORY_FILES);
      const summaries: SessionSummary[] = [];
      for (const { file, mtime } of recent) {
        const hit = cache.get(file.path);
        if (hit?.mtime === mtime) {
          summaries.push({ ...hit.summary, title: sessionTitle(file) });
          continue;
        }
        try {
          const entries = deps.parse(await readFile(file.path, "utf-8")).filter((e) => (e as EntryLike).type !== "session");
          const summary = summarise(file.path, sessionTitle(file), buildReport(entries as EntryLike[], null));
          cache.set(file.path, { mtime, summary });
          summaries.push(summary);
        } catch {
          // A damaged or half-written session file must not hide the others.
        }
      }
      const kept = new Set(recent.map((r) => r.file.path));
      for (const path of cache.keys()) if (!kept.has(path)) cache.delete(path);
      return summaries;
    },
  };
}

export const RANGES = [
  { label: "Today", title: "today", days: 1, chartDays: 7 },
  { label: "7 days", title: "last 7 days", days: 7, chartDays: 7 },
  { label: "30 days", title: "last 30 days", days: 30, chartDays: 30 },
] as const;

/** The last `n` local days, oldest first, as YYYY-MM-DD. */
export function lastDays(now: number, n: number): string[] {
  const today = new Date(now);
  return Array.from({ length: n }, (_, i) =>
    dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i), 12).getTime()),
  );
}

export interface RangeTotals {
  cost: number;
  calls: number;
  /** Sessions with spend in the range, most recently active first, with their spend in it. */
  sessions: { session: SessionSummary; cost: number; calls: number }[];
  /** Spend per day over the chart's days, oldest first. */
  chart: { day: string; cost: number }[];
}

export function rangeTotals(sessions: readonly SessionSummary[], days: number, chartDays: number, now: number): RangeTotals {
  const inRange = new Set(lastDays(now, days));
  const chart = new Map(lastDays(now, chartDays).map((d) => [d, 0]));
  const rows: RangeTotals["sessions"] = [];
  let cost = 0;
  let calls = 0;
  for (const session of sessions) {
    let sCost = 0;
    let sCalls = 0;
    for (const d of session.days) {
      if (chart.has(d.day)) chart.set(d.day, (chart.get(d.day) as number) + d.cost);
      if (!inRange.has(d.day)) continue;
      sCost += d.cost;
      sCalls += d.calls;
    }
    if (sCost <= 0 && sCalls === 0) continue;
    rows.push({ session, cost: sCost, calls: sCalls });
    cost += sCost;
    calls += sCalls;
  }
  rows.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  return { cost, calls, sessions: rows, chart: [...chart.entries()].map(([day, c]) => ({ day, cost: c })) };
}
