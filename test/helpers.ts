import type { UsageReport } from "../src/report.js";

type CostIn = Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;

export function usage(total: number, tokens: CostIn = {}) {
  return {
    input: tokens.input ?? 100,
    output: tokens.output ?? 50,
    cacheRead: tokens.cacheRead ?? 0,
    cacheWrite: tokens.cacheWrite ?? 0,
    cost: { input: total / 2, output: total / 4, cacheRead: total / 8, cacheWrite: total / 8, total },
  };
}

let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 18, 12, 0, tick++)).toISOString();

export const user = () => ({ type: "message", timestamp: stamp(), message: { role: "user" } });

export const assistant = (total: number, model = "m1", tokens: CostIn = {}, provider = "p") => ({
  type: "message",
  timestamp: stamp(),
  message: { role: "assistant", provider, model, usage: usage(total, tokens) },
});

export const toolResult = (total: number) => ({
  type: "message",
  timestamp: stamp(),
  message: { role: "toolResult", usage: usage(total) },
});

export const usageEntry = (total: number, provider = "p", model = "m1") => ({
  type: "usage",
  timestamp: stamp(),
  provider,
  model,
  usage: usage(total),
});

export const compaction = (total: number) => ({
  type: "compaction",
  timestamp: stamp(),
  usage: usage(total),
});

export function sampleReport(over: Partial<UsageReport> = {}): UsageReport {
  return {
    version: 1,
    startedAt: Date.UTC(2026, 9, 18, 12, 0, 0),
    updatedAt: Date.UTC(2026, 9, 18, 13, 12, 0),
    calls: 23,
    lastTurnCost: 0.31,
    tokens: { input: 148_000, output: 166_000, cacheRead: 1_310_000, cacheWrite: 112_000, reasoning: 104_000 },
    cost: { input: 2.22, output: 0.21, cacheRead: 1.96, cacheWrite: 0.42, total: 4.82 },
    cacheHitPct: 89,
    context: { tokens: 118_000, window: 1_000_000, percent: 11.8 },
    byModel: [
      { key: "p/claude-opus", cost: 4.31, tokens: 1_500_000, calls: 18 },
      { key: "p/claude-haiku", cost: 0.51, tokens: 236_000, calls: 5 },
    ],
    series: [
      { at: Date.UTC(2026, 9, 18, 12, 1, 0), cost: 0.1, tokens: 1000 },
      { at: Date.UTC(2026, 9, 18, 12, 2, 0), cost: 0.62, tokens: 9000 },
      { at: Date.UTC(2026, 9, 18, 12, 3, 0), cost: 0.31, tokens: 5000 },
    ],
    ...over,
  };
}
