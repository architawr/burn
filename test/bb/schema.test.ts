import { describe, expect, it } from "vitest";
import { usageEnvelopeSchema, usageReportSchema } from "../../extensions/bb/schema.js";
import {
  buildReport,
  CALL_COSTS_MAX,
  DAY_MODELS_MAX,
  DAYS_MAX,
  MODELS_MAX,
  PROMPT_MAX,
  SERIES_MAX,
  TURN_MODELS_MAX,
  TURN_TOOLS_MAX,
  TURNS_MAX,
} from "../../src/report.js";
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
    expect(parsed).toMatchObject({ version: 2, turnCount: 0, turns: [], days: [], utcDays: [], running: false, budget: null, stoppedAt: null });
    expect(parsed.series.every((p) => p.turn === 0)).toBe(true);
  });

  it("reads a version 2 report from Burn 0.2, which has no UTC days, with none", () => {
    const { utcDays, ...older } = sampleReport();
    expect(usageReportSchema.parse(older).utcDays).toEqual([]);
    expect(usageReportSchema.parse(sampleReport()).utcDays).toEqual(sampleReport().utcDays);
    const tooMany = Array.from({ length: DAYS_MAX + 1 }, () => sampleReport().utcDays[0]);
    expect(usageReportSchema.safeParse({ ...sampleReport(), utcDays: tooMany }).success).toBe(false);
  });

  it("keeps a report at every array limit, UTC days included, under the 128 KiB a POST or host batch allows", () => {
    // Real provider/model keys run to about 40 characters; the schema allows longer ones.
    const key = (i: number) => `anthropic/claude-opus-4-5-2025110${i}-long`.padEnd(40, "x");
    const f = 0.12345678901234568;
    const day = (i: number) => ({
      day: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      cost: f,
      calls: 123_456,
      models: Array.from({ length: DAY_MODELS_MAX }, (_, j) => ({ key: key(j), cost: f })),
    });
    const report = sampleReport({
      byModel: Array.from({ length: MODELS_MAX }, (_, i) => ({ key: key(i), cost: f, tokens: 123_456_789, calls: 12_345 })),
      series: Array.from({ length: SERIES_MAX }, () => ({ at: 1_792_361_592_787, cost: f, tokens: 123_456, turn: 50 })),
      turns: Array.from({ length: TURNS_MAX }, (_, n) => ({
        n,
        at: 1_792_361_592_787,
        endAt: 1_792_361_592_787,
        prompt: `${"x".repeat(PROMPT_MAX - 1)}\u2026`,
        calls: 999,
        cost: f,
        tokens: { input: 123_456, output: 123_456, cacheRead: 12_345_678, cacheWrite: 123_456 },
        callCosts: Array.from({ length: CALL_COSTS_MAX }, () => f),
        tools: Array.from({ length: TURN_TOOLS_MAX }, (_, i) => ({ name: `tool_name_number_${i}`, count: 999 })),
        models: Array.from({ length: TURN_MODELS_MAX }, (_, i) => key(i)),
      })),
      days: Array.from({ length: DAYS_MAX }, (_, i) => day(i)),
      utcDays: Array.from({ length: DAYS_MAX }, (_, i) => day(i)),
    });
    expect(usageReportSchema.safeParse(report).success).toBe(true);
    const envelope = { threadId: "thr_aaaaaaaaaaaa", sentAt: 1_792_361_592_787, report };
    expect(Buffer.byteLength(JSON.stringify(envelope))).toBeLessThan(128 * 1024);
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
