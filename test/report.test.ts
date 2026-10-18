import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReport, dayKey, type EntryLike, forkedAt, PROMPT_MAX, promptExcerpt, slimEntry, TURNS_MAX } from "../src/report.js";
import { assistant, compaction, toolResult, usageEntry, user } from "./helpers.js";

const at = (iso: string) => <T extends { timestamp: string }>(entry: T): T => ({ ...entry, timestamp: iso });

describe("buildReport", () => {
  it("returns zeros for no entries", () => {
    const r = buildReport([], undefined);
    expect(r).toMatchObject({ calls: 0, lastTurnCost: 0, startedAt: 0, updatedAt: 0, byModel: [], series: [], context: null });
    expect(r.cost.total).toBe(0);
    expect(r.cacheHitPct).toBeNull();
  });

  it("sums assistant usage and counts calls and series", () => {
    const r = buildReport([user(), assistant(1, "m1", { input: 10, output: 5, cacheRead: 90 }), assistant(2, "m1", { input: 20, output: 5 })], undefined);
    expect(r.calls).toBe(2);
    expect(r.cost.total).toBeCloseTo(3);
    expect(r.tokens).toMatchObject({ input: 30, output: 10, cacheRead: 90 });
    expect(r.series).toHaveLength(2);
    expect(r.series[0]).toMatchObject({ cost: 1, tokens: 105 });
    expect(r.cacheHitPct).toBeCloseTo((90 / 120) * 100);
  });

  it("counts toolResult, usage and compaction usage in totals but not in calls or series", () => {
    const r = buildReport([user(), assistant(1), toolResult(2), usageEntry(3), compaction(4)], undefined);
    expect(r.cost.total).toBeCloseTo(10);
    expect(r.calls).toBe(1);
    expect(r.series).toHaveLength(1);
  });

  it("lastTurnCost covers every usage entry after the last user message", () => {
    const r = buildReport([user(), assistant(5), user(), assistant(1), toolResult(0.5), compaction(0.25)], undefined);
    expect(r.lastTurnCost).toBeCloseTo(1.75);
  });

  it("groups by provider/model, folds the tail into Other and keeps rows summing to the total", () => {
    const entries: EntryLike[] = [user()];
    for (let i = 1; i <= 9; i++) entries.push(assistant(i, `m${i}`));
    entries.push(toolResult(0.5));
    const r = buildReport(entries, undefined);
    expect(r.byModel).toHaveLength(8);
    expect(r.byModel[0]?.key).toBe("p/m9");
    expect(r.byModel.at(-1)?.key).toBe("Other");
    expect(r.byModel.reduce((s, row) => s + row.cost, 0)).toBeCloseTo(r.cost.total);
    expect(r.byModel.find((row) => row.key === "Tools/summaries")?.calls ?? 0).toBe(0);
  });

  it("prefers responseModel and drops rows with no cost and no tokens", () => {
    const named = assistant(1);
    (named.message as { responseModel?: string }).responseModel = "actual";
    const empty = assistant(0, "none", { input: 0, output: 0 });
    const r = buildReport([user(), named, empty], undefined);
    expect(r.byModel.map((row) => row.key)).toEqual(["p/actual"]);
  });

  it("caps the series at the last 60 calls", () => {
    const entries: EntryLike[] = [user()];
    for (let i = 0; i < 70; i++) entries.push(assistant(1));
    const r = buildReport(entries, undefined);
    expect(r.series).toHaveLength(60);
    expect(r.calls).toBe(70);
  });

  it("falls back to a finite timestamp when one cannot be parsed", () => {
    const bad = assistant(1);
    bad.timestamp = "not a date";
    const r = buildReport([user(), bad, assistant(1)], undefined);
    expect(Number.isFinite(r.startedAt)).toBe(true);
    expect(r.series.every((p) => Number.isFinite(p.at))).toBe(true);
  });

  it("passes the context through", () => {
    const context = { tokens: 10, window: 100, percent: 10 };
    expect(buildReport([], context).context).toEqual(context);
  });

  it("splits calls into turns at each user message", () => {
    const r = buildReport(
      [
        user("read the README"),
        assistant(0.1, "m1", {}, "p", ["read", "read"]),
        toolResult(0.05),
        assistant(0.2, "m1", {}, "p", ["bash"]),
        user([{ type: "text", text: "now\n  fix   it" }, { type: "image" }]),
        assistant(0.5, "m2"),
      ],
      undefined,
    );
    expect(r.turnCount).toBe(2);
    expect(r.turns.map((t) => [t.n, t.prompt, t.calls])).toEqual([
      [1, "read the README", 2],
      [2, "now fix it", 1],
    ]);
    expect(r.turns[0]?.cost).toBeCloseTo(0.35);
    expect(r.turns[0]?.callCosts).toEqual([0.1, 0.2]);
    expect(r.turns[0]?.tools).toEqual([
      { name: "read", count: 2 },
      { name: "bash", count: 1 },
    ]);
    expect(r.turns[1]?.models).toEqual(["p/m2"]);
    expect(r.series.map((p) => p.turn)).toEqual([1, 1, 2]);
    expect(r.lastTurnCost).toBeCloseTo(0.5);
  });

  it("keeps usage before the first prompt in turn 0", () => {
    const r = buildReport([usageEntry(1), user(), assistant(2)], undefined);
    expect(r.turns.map((t) => t.n)).toEqual([0, 1]);
    expect(r.turnCount).toBe(1);
  });

  it("keeps a prompt with no calls as an empty turn", () => {
    const r = buildReport([user("hi"), user("again"), assistant(1)], undefined);
    expect(r.turns.map((t) => t.calls)).toEqual([0, 1]);
  });

  it("caps the turns at the last TURNS_MAX and counts them all", () => {
    const entries: EntryLike[] = [];
    for (let i = 0; i < TURNS_MAX + 5; i++) entries.push(user(`p${i}`), assistant(1));
    const r = buildReport(entries, undefined);
    expect(r.turns).toHaveLength(TURNS_MAX);
    expect(r.turnCount).toBe(TURNS_MAX + 5);
    expect(r.turns.at(-1)?.n).toBe(TURNS_MAX + 5);
  });

  it("totals spend per local day with its top models", () => {
    const a = assistant(1, "m1");
    const b = assistant(2, "m2");
    b.timestamp = new Date(Date.parse(a.timestamp) + 86_400_000).toISOString();
    const r = buildReport([user(), a, b], undefined);
    expect(r.days.map((d) => [d.day, d.cost, d.calls])).toEqual([
      [dayKey(Date.parse(a.timestamp)), 1, 1],
      [dayKey(Date.parse(b.timestamp)), 2, 1],
    ]);
    expect(r.days[1]?.models).toEqual([{ key: "p/m2", cost: 2 }]);
  });

  it("starts as a v2 report that is not running and has no budget", () => {
    expect(buildReport([], undefined)).toMatchObject({ version: 2, running: false, budget: null, stoppedAt: null, turns: [], days: [], utcDays: [] });
  });

  it("counts only entries at or after countFrom, so a fork skips its parent's copied calls", () => {
    const copied = [at("2026-10-18T10:00:00.000Z")(user("parent")), at("2026-10-18T10:01:00.000Z")(assistant(5))];
    const own = [at("2026-10-18T12:00:00.000Z")(user("side chat")), at("2026-10-18T12:01:00.000Z")(assistant(1.5))];
    const r = buildReport([...copied, ...own], null, { countFrom: Date.parse("2026-10-18T12:00:00.000Z") });
    expect(r.cost.total).toBeCloseTo(1.5);
    expect(r).toMatchObject({ calls: 1, turnCount: 1, startedAt: Date.parse("2026-10-18T12:00:00.000Z") });
    expect(r.turns.map((t) => [t.n, t.prompt])).toEqual([[1, "side chat"]]);
    expect(buildReport([...copied, ...own], null, { countFrom: null }).cost.total).toBeCloseTo(6.5);
  });

  it("totals spend per UTC day beside the local days, and per the given zone's days", () => {
    const late = at("2026-10-18T23:30:00.000Z")(assistant(1));
    const early = at("2026-10-19T00:30:00.000Z")(assistant(2));
    const r = buildReport([user(), late, early], null, { timeZone: "America/Toronto" });
    expect(r.days.map((d) => [d.day, d.cost, d.calls])).toEqual([["2026-10-18", 3, 2]]);
    expect(r.utcDays.map((d) => [d.day, d.cost, d.calls])).toEqual([
      ["2026-10-18", 1, 1],
      ["2026-10-19", 2, 1],
    ]);
    expect(r.utcDays[1]?.models).toEqual([{ key: "p/m1", cost: 2 }]);
  });
});

describe("dayKey", () => {
  it("gives the calendar day in the process zone, or in the zone named", () => {
    const ms = Date.parse("2026-10-18T23:30:00.000Z");
    const d = new Date(ms);
    expect(dayKey(ms)).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    expect(dayKey(ms, "UTC")).toBe("2026-10-18");
    expect(dayKey(ms, "Asia/Tokyo")).toBe("2026-10-19");
    expect(dayKey(ms, "America/Los_Angeles")).toBe("2026-10-18");
  });
});

describe("forkedAt", () => {
  it("is the header's time when the session was forked from another, else null", () => {
    const header = { type: "session", version: 3, id: "s", timestamp: "2026-10-18T12:00:00.000Z", cwd: "/tmp" };
    expect(forkedAt({ ...header, parentSession: "/tmp/parent.jsonl" })).toBe(Date.parse("2026-10-18T12:00:00.000Z"));
    expect(forkedAt(header)).toBeNull();
    expect(forkedAt({ ...header, parentSession: "" })).toBeNull();
    expect(forkedAt({ ...header, parentSession: "/p", timestamp: "not a date" })).toBeNull();
    expect(forkedAt(null)).toBeNull();
    expect(forkedAt(undefined)).toBeNull();
  });
});

describe("slimEntry", () => {
  const raw = readFileSync(new URL("./fixtures/session.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
  const entries = raw.filter((e) => (e as EntryLike).type !== "session") as EntryLike[];

  it("builds the same report from slim entries as from a real session log", () => {
    const slim = raw.map(slimEntry).filter((e) => e !== null);
    expect(slim).toHaveLength(entries.length);
    expect(buildReport(slim, null)).toEqual(buildReport(entries, null));
    expect(buildReport(entries, null).calls).toBeGreaterThan(10);
  });

  it("keeps only what the report reads", () => {
    const long = `${"word ".repeat(60)}end`;
    const call = assistant(1, "m1", {}, "p", ["bash", "read"]);
    const slim = slimEntry({ ...call, id: "x", message: { ...call.message, api: "a", content: [...call.message.content, { type: "thinking", thinking: long }] } });
    expect(slim).toEqual({
      type: "message",
      timestamp: call.timestamp,
      message: {
        role: "assistant",
        provider: "p",
        model: "m1",
        usage: call.message.usage,
        content: [
          { type: "toolCall", name: "bash" },
          { type: "toolCall", name: "read" },
        ],
      },
    });
    const prompt = slimEntry(user([{ type: "text", text: long }, { type: "image", data: "…" }])) as unknown as { message: { content: string } };
    expect(prompt.message.content).toHaveLength(PROMPT_MAX);
    expect(slimEntry({ type: "model_change", id: "m", timestamp: "2026-10-18T12:00:00.000Z", modelId: "x" })).toEqual({
      type: "model_change",
      timestamp: "2026-10-18T12:00:00.000Z",
    });
    const branch = { type: "branch_summary", timestamp: "2026-10-18T12:00:00.000Z", summary: long, usage: compaction(1).usage };
    expect(slimEntry(branch)).toEqual({ type: "branch_summary", timestamp: branch.timestamp, usage: branch.usage });
    const spent = usageEntry(2, "q", "m2");
    expect(slimEntry({ ...spent, kind: "cache_warm" })).toEqual(spent);
  });

  it("is null for the session header and for anything that is not an entry", () => {
    expect(slimEntry({ type: "session", timestamp: "2026-10-18T12:00:00.000Z", parentSession: "/p" })).toBeNull();
    for (const value of [null, 1, "x", [], { type: "message" }, { timestamp: "t" }, { type: 1, timestamp: "t" }]) expect(slimEntry(value)).toBeNull();
  });
});

describe("promptExcerpt", () => {
  it("joins text blocks, collapses whitespace and trims to 120 characters", () => {
    expect(promptExcerpt([{ type: "text", text: " a\n b " }, { type: "text", text: "c" }])).toBe("a b c");
    expect(promptExcerpt(undefined)).toBe("");
    const long = promptExcerpt("x".repeat(300));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
