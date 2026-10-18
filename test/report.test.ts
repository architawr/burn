import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report.js";
import { assistant, compaction, toolResult, usageEntry, user } from "./helpers.js";

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
    const entries = [user()];
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
    const entries = [user()];
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
});
