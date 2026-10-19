import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { PLAIN, type PanelTheme } from "../../extensions/pi/draw.js";
import type { SessionSummary } from "../../extensions/pi/history.js";
import { BurnPanel, type PanelOptions, type PanelView, VIEWS } from "../../extensions/pi/panel.js";
import { dayKey } from "../../src/report.js";
import { dayRow, sampleReport } from "../helpers.js";

const KEY = { tab: "\t", shiftTab: "\x1b[Z", left: "\x1b[D", right: "\x1b[C", up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b" };
const NOW = Date.UTC(2026, 9, 18, 13, 12, 0);
const WIDTHS = [40, 60, 80, 120];
const text = (lines: string[]) => lines.join("\n");

const tagged: PanelTheme = { ...PLAIN, inverse: (t) => `[${t}]` };

function panel(over: Partial<PanelOptions> = {}) {
  const done = vi.fn();
  const requestRender = vi.fn();
  const p = new BurnPanel({ report: sampleReport(), budget: null, theme: PLAIN, done, requestRender, rows: () => 60, now: () => NOW, ...over });
  return { p, done, requestRender };
}

const session = (path: string, title: string, cost: number, calls: number, hoursAgo: number): SessionSummary => ({
  path,
  title,
  startedAt: NOW - (hoursAgo + 1) * 3_600_000,
  updatedAt: NOW - hoursAgo * 3_600_000,
  calls,
  cost,
  days: [dayRow(dayKey(NOW - hoursAgo * 3_600_000), cost, {}, calls)],
  utcDays: [dayRow(dayKey(NOW - hoursAgo * 3_600_000, "UTC"), cost, {}, calls)],
});

const history = (sessions: SessionSummary[]) => ({
  cwd: "/work/burn",
  currentPath: "/s/current",
  currentTitle: "burn UX polish",
  load: vi.fn(async () => sessions),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("BurnPanel views", () => {
  it("renders every view at every width without a line exceeding it", async () => {
    const h = history([session("/s/other", "fix bb footer selector", 5.12, 41, 2)]);
    for (const view of VIEWS.map((v) => v.key)) {
      for (const width of WIDTHS) {
        const { p } = panel({ view, history: h, budget: 10 });
        await flush();
        p.handleInput(KEY.enter);
        const lines = p.render(width);
        for (const line of lines) expect(visibleWidth(line), `${view} at ${width}: ${line}`).toBe(width);
        expect(lines[0]).toMatch(/^╭─/);
        expect(lines[lines.length - 1]).toMatch(/^╰.*╯$/);
      }
    }
  });

  it("frames the overview with the flame, Burn, the tabs with the active one inverted, and key hints", () => {
    const lines = panel({ theme: tagged }).p.render(100);
    expect(lines[0]).toContain("\uf06d Burn");
    expect(lines[0]).toContain("[ Overview ] Turns  Models  History");
    expect(lines[lines.length - 1]).toContain("tab views");
    expect(lines[lines.length - 1]).toContain("c copy");
    expect(lines[lines.length - 1]).toContain("esc close");
  });

  it("shows the overview's headline, meta line, breakdown, charts, models and cache", () => {
    const out = text(panel().p.render(100));
    for (const part of [
      "$4.82 spent",
      "+$0.31 last turn",
      "$0.21 per call",
      "23 calls · 4 prompts · 1h 12m",
      "No budget · /burn budget 10 sets one",
      "Where it went",
      "■ input",
      "■ cache write",
      "output includes 104k reasoning",
      "Spend over time",
      "priciest $0.62 · turn 2",
      "median   $0.31",
      "last     $0.31",
      "turn",
      "Models",
      "claude-opus",
      "Cache 89% hit",
      "Context 118k / 1.0M",
    ]) {
      expect(out).toContain(part);
    }
    expect(out).toMatch(/1─+2─+3─+ turn/);
    expect(out).not.toMatch(/saved|per hour|\/ hour/);
  });

  it("draws the budget bar with its percentage, and marks over budget", () => {
    expect(text(panel({ budget: 10 }).p.render(100))).toMatch(/budget \$10 ━+ 48%/);
    const over = sampleReport({ cost: { ...sampleReport().cost, total: 12.4 } });
    expect(text(panel({ budget: 10, report: over }).p.render(100))).toContain("124% ▲");
  });

  it("says when Burn stopped a run", () => {
    const report = sampleReport({ stoppedAt: new Date(2026, 9, 18, 13, 2).getTime() });
    expect(text(panel({ budget: 10, report }).p.render(100))).toContain("Stopped at the $10 budget at 13:02");
  });

  it("collapses to the compact overview under 60 columns", () => {
    const out = text(panel().p.render(44));
    expect(out).toContain("$4.82 spent · +$0.31 last");
    expect(out).toContain("■ in $2.22");
    expect(out).toContain("claude-opus $4.31 89%");
    expect(out).not.toContain("Where it went");
    expect(panel().p.render(44)[0]).toContain("Overview 1/4");
  });

  it("shows tokens for a session that reports no cost", () => {
    const report = sampleReport({
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      byModel: [{ key: "p/local", cost: 0, tokens: 1_736_000, calls: 23, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timed: 0, ms: 0, failed: 0 }],
    });
    const out = text(panel({ report }).p.render(100));
    expect(out).toContain("1.7M tok used");
    expect(out).not.toContain("$0.00");
  });

  it("shows an empty state with no calls", () => {
    const report = sampleReport({ calls: 0, series: [], byModel: [], turns: [], turnCount: 0, cost: { ...sampleReport().cost, total: 0 } });
    expect(text(panel({ report }).p.render(80))).toContain("No model calls yet");
    expect(text(panel({ report, view: "turns" }).p.render(80))).toContain("No prompts yet");
  });

  it("lists turns newest first with their prompt, calls, tools and cost", () => {
    const lines = panel({ view: "turns" }).p.render(100);
    const rows = lines.filter((l) => /\$\d/.test(l));
    expect(rows[0]).toContain("now add tests for the empty-input case");
    expect(rows[0]).toContain("▸");
    expect(rows[2]).toMatch(/2 .* refactor the parser .*3 +11 +\$2\.92/);
    expect(text(lines)).toContain("enter expand");
    expect(text(lines)).not.toContain("jump to message");
  });

  it("models every model with tokens, cost per call and share, then spend by day", () => {
    const out = text(panel({ view: "models" }).p.render(100));
    expect(out).toMatch(/claude-opus +p +18 +1\.5M +\$4\.31 +\$0\.24/);
    expect(out).toContain("claude-haiku");
    expect(out).toContain("89%");
    expect(out).toContain("By day");
    expect(out).toContain("Oct 18");
  });
});

describe("BurnPanel keys", () => {
  it("cycles views with tab, shift+tab and the arrows, and jumps with 1 to 4", () => {
    const { p, requestRender } = panel();
    const seen: PanelView[] = [];
    for (const key of [KEY.tab, KEY.tab, KEY.right, KEY.right, KEY.shiftTab, KEY.left, "3", "1", "4", "2"]) {
      p.handleInput(key);
      seen.push(p.current());
    }
    expect(seen).toEqual(["turns", "models", "history", "overview", "history", "models", "models", "overview", "history", "turns"]);
    expect(requestRender).toHaveBeenCalled();
    expect(p.render(100)[0]).toContain("Turns");
  });

  it("selects and expands a turn with the arrows and enter", () => {
    const { p } = panel({ view: "turns" });
    p.handleInput(KEY.down);
    p.handleInput(KEY.down);
    p.handleInput(KEY.enter);
    const out = text(p.render(100));
    expect(out).toMatch(/▸ +2 /);
    expect(out).toContain("Turn 2 · ");
    expect(out).toContain("3 calls · 11 tools");
    expect(out).toMatch(/\d\.\d× median turn/);
    expect(out).toContain("“refactor the parser to return Result and update every caller”");
    expect(out).toContain("in 1.0k  cache 20k  write 2.0k  out 500");
    expect(out).toContain("$0.62 $1.40 $0.90");
    expect(out).toContain("bash ×6 · edit ×5");
    expect(out).toContain("enter collapse");
    p.handleInput(KEY.enter);
    expect(text(p.render(100))).not.toContain("Turn 2 · ");
  });

  it("scrolls a long turn list to keep the selection visible", () => {
    const base = sampleReport().turns[0]!;
    const turns = Array.from({ length: 40 }, (_, i) => ({ ...base, n: i + 1, prompt: `prompt number ${i + 1}` }));
    const { p } = panel({ view: "turns", report: sampleReport({ turns, turnCount: 40 }), rows: () => 24 });
    const first = p.render(80);
    expect(first.length).toBeLessThanOrEqual(22);
    expect(text(first)).toContain("prompt number 40");
    for (let i = 0; i < 39; i++) p.handleInput(KEY.down);
    const last = text(p.render(80));
    expect(last).toContain("prompt number 1");
    expect(last).not.toContain("prompt number 40");
  });

  it("copies the Markdown summary with c and flashes the hint", async () => {
    const copy = vi.fn(async (_text: string) => {});
    const { p } = panel({ copy, budget: 10 });
    p.handleInput("c");
    await flush();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("**$4.82** of a $10 budget"));
    expect(p.render(100).at(-1)).toContain("Copied");
    p.dispose();
  });

  it("closes on escape, q and Q only", () => {
    for (const key of [KEY.esc, "q", "Q"]) {
      const { p, done } = panel();
      p.handleInput("x");
      expect(done).not.toHaveBeenCalled();
      p.handleInput(key);
      expect(done).toHaveBeenCalledWith(undefined);
    }
  });

  it("caches by width, drops the cache on invalidate and shows a live update", () => {
    const { p } = panel();
    const first = p.render(80);
    expect(p.render(80)).toBe(first);
    p.invalidate();
    expect(p.render(80)).not.toBe(first);
    p.update(sampleReport({ cost: { ...sampleReport().cost, total: 6.5 }, running: true }), null);
    const live = text(p.render(80));
    expect(live).toContain("$6.50 spent");
    expect(live).toContain("+$0.31… this turn");
  });
});

describe("BurnPanel history", () => {
  it("loads this project's sessions, shows Loading first, and marks the open one", async () => {
    const h = history([session("/s/other", "fix bb footer selector", 5.12, 41, 2), session("/s/old", "last week", 3, 9, 72)]);
    const { p, requestRender } = panel({ view: "history", history: h });
    expect(text(p.render(100))).toContain("Loading sessions…");
    await flush();
    expect(requestRender).toHaveBeenCalled();
    const out = text(p.render(100));
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(out).toContain("This project · /work/burn");
    expect(out).toContain("$9.94 today");
    expect(out).toContain("2 sessions · 64 calls");
    expect(out).toMatch(/▸ ● burn UX polish +\d\d:\d\d +23 +\$4\.82/);
    expect(out).toContain("fix bb footer selector");
    expect(out).not.toContain("last week");
    expect(out).toContain("[ ] range");
  });

  it("switches ranges with [ and ]", async () => {
    const h = history([session("/s/old", "last week", 3, 9, 72)]);
    const { p } = panel({ view: "history", history: h });
    await flush();
    p.handleInput("]");
    const week = text(p.render(100));
    expect(week).toContain("$7.82 last 7 days");
    expect(week).toContain("last week");
    p.handleInput("]");
    expect(text(p.render(100))).toContain("last 30 days");
    p.handleInput("[");
    p.handleInput("[");
    expect(text(p.render(100))).toContain("Sessions today");
  });

  it("resumes the selected session with enter, but not the open one", async () => {
    const h = history([session("/s/other", "fix bb footer selector", 5.12, 41, 2)]);
    const { p, done } = panel({ view: "history", history: h });
    await flush();
    p.handleInput(KEY.enter);
    expect(done).not.toHaveBeenCalled();
    expect(p.render(100).at(-1)).toContain("This is the open session");
    p.handleInput(KEY.down);
    p.handleInput(KEY.enter);
    expect(done).toHaveBeenCalledWith({ resume: "/s/other" });
  });

  it("switches between local and UTC days with u", async () => {
    const yesterday: SessionSummary = {
      ...session("/s/utc", "late last night", 2, 3, 2),
      days: [dayRow("2026-10-17", 2, {}, 3)],
      utcDays: [dayRow(dayKey(NOW, "UTC"), 2, {}, 3)],
    };
    const { p } = panel({ view: "history", history: history([yesterday]), report: sampleReport({ days: [], utcDays: [] }) });
    await flush();
    const local = text(p.render(120));
    expect(local).toContain("u UTC");
    expect(local).not.toContain("late last night");
    p.handleInput("u");
    const utc = text(p.render(120));
    expect(utc).toContain("$2.00 today (UTC)");
    expect(utc).toContain("late last night");
    expect(utc).toContain("u local");
    p.handleInput("u");
    expect(text(p.render(120))).not.toContain("(UTC)");
  });

  it("reports a failed load", async () => {
    const h = { ...history([]), load: vi.fn(async () => Promise.reject(new Error("no access"))) };
    const { p } = panel({ view: "history", history: h });
    await flush();
    expect(text(p.render(100))).toContain("Could not read this project's sessions: no access");
  });
});
