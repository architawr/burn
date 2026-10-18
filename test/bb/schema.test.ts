import { describe, expect, it } from "vitest";
import { usageEnvelopeSchema, usageReportSchema } from "../../extensions/bb/schema.js";
import { buildReport } from "../../src/report.js";
import { assistant, sampleReport, toolResult, user } from "../helpers.js";

describe("usageReportSchema", () => {
  it("accepts what buildReport produces", () => {
    const report = buildReport([user(), assistant(1), toolResult(2)], { tokens: 1, window: 2, percent: 50 });
    expect(usageReportSchema.safeParse(report).success).toBe(true);
    expect(usageReportSchema.safeParse(buildReport([], undefined)).success).toBe(true);
  });

  it("rejects negatives, NaN and oversize arrays", () => {
    const base = sampleReport();
    expect(usageReportSchema.safeParse({ ...base, cost: { ...base.cost, total: -1 } }).success).toBe(false);
    expect(usageReportSchema.safeParse({ ...base, lastTurnCost: Number.NaN }).success).toBe(false);
    const series = Array.from({ length: 61 }, () => ({ at: 1, cost: 1, tokens: 1 }));
    expect(usageReportSchema.safeParse({ ...base, series }).success).toBe(false);
    const byModel = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, cost: 1, tokens: 1, calls: 1 }));
    expect(usageReportSchema.safeParse({ ...base, byModel }).success).toBe(false);
  });

  it("upgrades a version 1 report from an older extension", () => {
    const { turnCount, turns, days, running, budget, stoppedAt, ...rest } = sampleReport();
    const v1 = { ...rest, version: 1, series: rest.series.map(({ turn, ...p }) => p) };
    const parsed = usageReportSchema.parse(v1);
    expect(parsed).toMatchObject({ version: 2, turnCount: 0, turns: [], days: [], running: false, budget: null, stoppedAt: null });
    expect(parsed.series.every((p) => p.turn === 0)).toBe(true);
  });

  it("drops unknown fields", () => {
    const parsed = usageReportSchema.parse({ ...sampleReport(), extra: 1 });
    expect("extra" in parsed).toBe(false);
  });
});

describe("usageEnvelopeSchema", () => {
  it("requires a bb thread id", () => {
    const base = { sentAt: 1, report: sampleReport() };
    expect(usageEnvelopeSchema.safeParse({ ...base, threadId: "thr_abc123def4" }).success).toBe(true);
    expect(usageEnvelopeSchema.safeParse({ ...base, threadId: "nope" }).success).toBe(false);
  });
});
