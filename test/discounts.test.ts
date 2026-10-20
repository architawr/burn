import { describe, expect, it } from "vitest";
import { applyDiscounts, type Discounts, discountCost, NO_DISCOUNTS } from "../src/discounts.js";
import { buildReport, type EntryLike } from "../src/report.js";
import { assistant, toolResult, usageEntry, user } from "./helpers.js";

const every = (pct: number): Discounts => ({ input: pct, output: pct, cacheRead: pct, cacheWrite: pct });

const onDay = (iso: string) => <T extends { timestamp: string }>(entry: T): T => ({ ...entry, timestamp: iso });

/** Two models, calls on two UTC days, two prompts, a toolResult and a "usage" entry. */
const entries = (): EntryLike[] => [
  onDay("2026-10-18T12:00:00.000Z")(user("first")),
  onDay("2026-10-18T12:01:00.000Z")(assistant(2, "m1", {}, "p", ["read"])),
  onDay("2026-10-18T12:02:00.000Z")(toolResult(0.4)),
  onDay("2026-10-18T12:03:00.000Z")(assistant(1, "m2")),
  onDay("2026-10-19T09:00:00.000Z")(user("second")),
  onDay("2026-10-19T09:01:00.000Z")(assistant(3, "m1")),
  onDay("2026-10-19T09:02:00.000Z")(usageEntry(0.8, "p", "m2")),
];

type Costed = { usage?: { cost: Record<string, number> }; message?: { usage?: { cost: Record<string, number> } } };

/** A deep copy of `list` with every usage cost part and total times `factor`. */
function scaleCosts(list: EntryLike[], factor: number): EntryLike[] {
  return list.map((entry) => {
    const copy = structuredClone(entry) as EntryLike & Costed;
    const cost = copy.usage?.cost ?? copy.message?.usage?.cost;
    if (cost) for (const k of Object.keys(cost)) cost[k] = (cost[k] ?? 0) * factor;
    return copy;
  });
}

const round9 = (value: unknown): unknown => {
  if (typeof value === "number") return Math.round(value * 1e9) / 1e9 || 0;
  if (Array.isArray(value)) return value.map(round9);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round9(v)]));
  return value;
};

const numbersIn = (value: unknown): number[] => {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(numbersIn);
  return [];
};

describe("discountCost", () => {
  const cost = { input: 4, output: 2, cacheRead: 1, cacheWrite: 1, total: 8 };

  it("takes each line item's percentage off its list cost", () => {
    const got = discountCost(cost, { ...NO_DISCOUNTS, input: 50, cacheRead: 10 });
    expect(got.input).toBeCloseTo(2);
    expect(got.output).toBeCloseTo(2);
    expect(got.cacheRead).toBeCloseTo(0.9);
    expect(got.cacheWrite).toBeCloseTo(1);
    expect(got.total).toBeCloseTo(5.9);
  });

  it("raises a line item's cost for a negative discount", () => {
    const got = discountCost(cost, { ...NO_DISCOUNTS, output: -10 });
    expect(got.output).toBeCloseTo(2.2);
    expect(got.total).toBeCloseTo(8.2);
  });

  it("keeps cost reported as one total, beyond its parts, as reported", () => {
    const got = discountCost({ ...cost, total: 10 }, { ...NO_DISCOUNTS, input: 50, cacheRead: 10 });
    expect(got.total).toBeCloseTo(7.9);
  });
});

describe("applyDiscounts", () => {
  it("returns the same report when nothing is discounted or nothing cost anything", () => {
    const report = buildReport(entries(), null, { timeZone: "UTC" });
    expect(applyDiscounts(report, NO_DISCOUNTS)).toBe(report);
    const tokenOnly = buildReport(scaleCosts(entries(), 0), null, { timeZone: "UTC" });
    expect(applyDiscounts(tokenOnly, every(16))).toBe(tokenOnly);
  });

  it("never changes its input", () => {
    const report = buildReport(entries(), null, { timeZone: "UTC" });
    const before = structuredClone(report);
    applyDiscounts(report, { input: 50, output: -10, cacheRead: 10, cacheWrite: 100 });
    expect(report).toEqual(before);
  });

  // Fails when a new cost field in UsageReport is not discounted.
  it("prices every cost figure as if every call had cost that much less", () => {
    const listed = entries();
    const got = applyDiscounts(buildReport(listed, null, { timeZone: "UTC" }), every(25));
    const want = buildReport(scaleCosts(listed, 0.75), null, { timeZone: "UTC" });
    expect(round9(got)).toEqual(round9(want));
  });

  it("keeps the totals, each day and the split by line item exact with mixed discounts", () => {
    const d: Discounts = { input: 50, output: 0, cacheRead: 10, cacheWrite: -20 };
    const report = buildReport(entries(), null, { timeZone: "UTC" });
    const got = applyDiscounts(report, d);
    const exact = (c: { input: number; output: number; cacheRead: number; cacheWrite: number }) => ({
      input: c.input * 0.5,
      output: c.output,
      cacheRead: c.cacheRead * 0.9,
      cacheWrite: c.cacheWrite * 1.2,
    });
    const want = exact(report.cost);
    expect(got.cost).toMatchObject(want);
    expect(got.cost.total).toBeCloseTo(want.input + want.output + want.cacheRead + want.cacheWrite, 12);
    expect(got.days).toHaveLength(2);
    for (const [i, day] of got.days.entries()) {
      const before = report.days[i];
      if (!before) throw new Error("missing day");
      const parts = exact(before.costs);
      expect(day.costs).toEqual(parts);
      expect(day.cost).toBeCloseTo(parts.input + parts.output + parts.cacheRead + parts.cacheWrite, 12);
      expect(day.models.reduce((sum, m) => sum + m.cost, 0)).toBeCloseTo(day.cost, 12);
    }
    expect(got.byModel.reduce((sum, m) => sum + m.cost, 0)).toBeCloseTo(got.cost.total, 12);
  });

  it("leaves nothing below zero when everything is free", () => {
    const rates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    const calls: EntryLike[] = [user()];
    for (let i = 0; i < 40; i++) {
      const tokens = { input: 1013 + i * 37, output: 211 + i * 13, cacheRead: 40_009 + i * 997, cacheWrite: 1777 + i * 71 };
      const parts = {
        input: (tokens.input * rates.input) / 1e6,
        output: (tokens.output * rates.output) / 1e6,
        cacheRead: (tokens.cacheRead * rates.cacheRead) / 1e6,
        cacheWrite: (tokens.cacheWrite * rates.cacheWrite) / 1e6,
      };
      const call = assistant(0);
      call.message.usage = { ...tokens, cost: { ...parts, total: parts.input + parts.output + parts.cacheRead + parts.cacheWrite } };
      calls.push(call);
    }
    const got = applyDiscounts(buildReport(calls, null), every(100));
    expect(got.cost.total).toBe(0);
    expect(numbersIn(got).filter((n) => n < 0)).toEqual([]);
  });
});
