import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryLoader, HISTORY_FILES, lastDays, rangeTotals, type SessionFile, sessionTitle } from "../../extensions/pi/history.js";
import { dayKey } from "../../src/report.js";
import { dayRow } from "../helpers.js";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 18, 15, 0).getTime();

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "burn-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const usage = (total: number) => ({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } });

/** A session file whose calls happened `daysAgo` local days before NOW, modified then too. */
function sessionFile(name: string, daysAgo: number, costs: number[], prompt = "do the thing", header: Record<string, unknown> = {}): string {
  const at = NOW - daysAgo * DAY;
  const stamp = (i: number) => new Date(at + i * 1000).toISOString();
  const lines = [
    { type: "session", version: 3, id: name, timestamp: stamp(0), cwd: dir, ...header },
    { type: "message", id: "u", parentId: null, timestamp: stamp(1), message: { role: "user", content: prompt } },
    ...costs.map((c, i) => ({
      type: "message",
      id: `a${i}`,
      parentId: "u",
      timestamp: stamp(2 + i),
      message: { role: "assistant", provider: "p", model: "m", usage: usage(c), content: [] },
    })),
  ];
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`);
  utimesSync(path, new Date(at), new Date(at));
  return path;
}

const info = (path: string, firstMessage = "do the thing", name?: string): SessionFile => ({ path, firstMessage, name });

describe("createHistoryLoader", () => {
  it("summarises this project's sessions from the last 30 days, newest first", async () => {
    const today = sessionFile("today", 0, [1, 0.5]);
    const week = sessionFile("week", 3, [2]);
    const old = sessionFile("old", 40, [9]);
    const files = [info(week, "week prompt", "Named session"), info(old), info(today, "  first\n message  "), info(join(dir, "missing.jsonl"))];
    const loader = createHistoryLoader({ list: async () => files, parse: parseSessionEntries, now: () => NOW });
    const sessions = await loader.load(dir);
    expect(sessions.map((s) => s.path)).toEqual([today, week]);
    expect(sessions[0]).toMatchObject({ title: "first message", calls: 2, cost: 1.5 });
    expect(sessions[1]).toMatchObject({ title: "Named session", calls: 1, cost: 2 });
    const spent = (day: string) => ({
      ...dayRow(day, 1.5, {}, 2),
      models: [{ key: "p/m", cost: 1.5, calls: 2, tokens: 30 }],
      prompts: 1,
      tokens: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      costs: { input: 1.5, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(sessions[0]!.days).toEqual([spent(dayKey(NOW))]);
    expect(sessions[0]!.utcDays).toEqual([spent(dayKey(NOW, "UTC"))]);
  });

  it("counts a forked session only from the time its header was written", async () => {
    const forkTime = new Date(NOW + 2500).toISOString();
    const fork = sessionFile("fork", 0, [4, 1, 0.5], "copied", { parentSession: join(dir, "parent.jsonl"), timestamp: forkTime });
    const loader = createHistoryLoader({ list: async () => [info(fork)], parse: parseSessionEntries, now: () => NOW + 10_000 });
    const [summary] = await loader.load(dir);
    expect(summary).toMatchObject({ cost: 1.5, calls: 2, startedAt: NOW + 3000 });
  });

  it("caches each file by path and modification time", async () => {
    const path = sessionFile("today", 0, [1]);
    const parse = vi.fn(parseSessionEntries);
    const loader = createHistoryLoader({ list: async () => [info(path)], parse, now: () => NOW });
    await loader.load(dir);
    await loader.load(dir);
    expect(parse).toHaveBeenCalledTimes(1);
    utimesSync(path, new Date(NOW - 1000), new Date(NOW - 1000));
    await loader.load(dir);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("reads at most HISTORY_FILES files", async () => {
    const files = Array.from({ length: HISTORY_FILES + 5 }, (_, i) => info(sessionFile(`s${i}`, 0, [0.01])));
    const loader = createHistoryLoader({ list: async () => files, parse: parseSessionEntries, now: () => NOW });
    expect(await loader.load(dir)).toHaveLength(HISTORY_FILES);
  });

  it("titles a session by its name, then its first message", () => {
    expect(sessionTitle({ name: " Burn ", firstMessage: "x" })).toBe("Burn");
    expect(sessionTitle({ firstMessage: "" })).toBe("(no messages)");
  });
});

describe("rangeTotals", () => {
  const summary = (path: string, daysAgo: number[], cost: number) => ({
    path,
    title: path,
    startedAt: NOW - Math.max(...daysAgo) * DAY,
    updatedAt: NOW - Math.min(...daysAgo) * DAY,
    calls: daysAgo.length,
    cost: cost * daysAgo.length,
    days: daysAgo.map((d) => dayRow(dayKey(NOW - d * DAY), cost, {}, 1)),
    utcDays: daysAgo.map((d) => dayRow(dayKey(NOW - d * DAY, "UTC"), cost, {}, 1)),
  });

  it("adds up spend per range and per day, listing sessions with spend in the range", () => {
    const sessions = [summary("a", [0, 1], 2), summary("b", [5], 3), summary("c", [20], 4)];
    const today = rangeTotals(sessions, 1, 7, NOW);
    expect(today).toMatchObject({ cost: 2, calls: 1 });
    expect(today.sessions.map((s) => s.session.path)).toEqual(["a"]);
    expect(today.chart).toHaveLength(7);
    expect(today.chart.at(-1)).toEqual({ day: dayKey(NOW), cost: 2 });
    expect(today.chart.reduce((sum, d) => sum + d.cost, 0)).toBe(7);
    const week = rangeTotals(sessions, 7, 7, NOW);
    expect(week).toMatchObject({ cost: 7, calls: 3 });
    expect(week.sessions.map((s) => [s.session.path, s.cost])).toEqual([["a", 4], ["b", 3]]);
    expect(rangeTotals(sessions, 30, 30, NOW)).toMatchObject({ cost: 11, calls: 4 });
  });

  it("lists local days oldest first", () => {
    const days = lastDays(NOW, 3);
    expect(days).toHaveLength(3);
    expect(days[2]).toBe(dayKey(NOW));
    expect(days[0] < days[1]! && days[1]! < days[2]!).toBe(true);
  });

  it("lists UTC days and sums each session's UTC days when asked", () => {
    const late = Date.UTC(2026, 9, 18, 23, 30);
    expect(lastDays(late, 2, true)).toEqual(["2026-10-17", "2026-10-18"]);
    const session = { ...summary("a", [0], 2), days: [], utcDays: [dayRow("2026-10-18", 2, {}, 1)] };
    expect(rangeTotals([session], 1, 7, late, true)).toMatchObject({ cost: 2, calls: 1 });
    expect(rangeTotals([session], 1, 7, late)).toMatchObject({ cost: 0, calls: 0 });
  });
});
