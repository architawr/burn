import type { TurnRow, UsageReport } from "../src/report.js";

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

export const user = (content: unknown = "do the thing") => ({ type: "message", timestamp: stamp(), message: { role: "user", content } });

export const assistant = (total: number, model = "m1", tokens: CostIn = {}, provider = "p", tools: string[] = []) => ({
  type: "message",
  timestamp: stamp(),
  message: {
    role: "assistant",
    provider,
    model,
    usage: usage(total, tokens),
    content: tools.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: {} })),
  },
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

const turnRow = (n: number, minute: number, prompt: string, callCosts: number[], tools: [string, number][] = []): TurnRow => ({
  n,
  at: Date.UTC(2026, 9, 18, 12, minute, 0),
  endAt: Date.UTC(2026, 9, 18, 12, minute + 2, 0),
  prompt,
  calls: callCosts.length,
  cost: callCosts.reduce((a, b) => a + b, 0),
  tokens: { input: 1000, output: 500, cacheRead: 20_000, cacheWrite: 2000 },
  callCosts,
  tools: tools.map(([name, count]) => ({ name, count })),
  models: ["p/claude-opus"],
});

export function sampleReport(over: Partial<UsageReport> = {}): UsageReport {
  return {
    version: 2,
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
      { at: Date.UTC(2026, 9, 18, 12, 1, 0), cost: 0.1, tokens: 1000, turn: 1 },
      { at: Date.UTC(2026, 9, 18, 12, 2, 0), cost: 0.62, tokens: 9000, turn: 2 },
      { at: Date.UTC(2026, 9, 18, 12, 3, 0), cost: 0.31, tokens: 5000, turn: 3 },
    ],
    turnCount: 4,
    turns: [
      turnRow(1, 1, "read the README and tell me what burn does", [0.1, 0.3], [["read", 2]]),
      turnRow(2, 10, "refactor the parser to return Result and update every caller", [0.62, 1.4, 0.9], [["bash", 6], ["edit", 5]]),
      turnRow(3, 30, "/review", [0.31, 0.2]),
      turnRow(4, 50, "now add tests for the empty-input case", [0.29, 0.02], [["edit", 1]]),
    ],
    days: [{ day: "2026-10-18", cost: 4.82, calls: 23, models: [{ key: "p/claude-opus", cost: 4.31 }, { key: "p/claude-haiku", cost: 0.51 }] }],
    utcDays: [{ day: "2026-10-18", cost: 4.82, calls: 23, models: [{ key: "p/claude-opus", cost: 4.31 }, { key: "p/claude-haiku", cost: 0.51 }] }],
    running: false,
    budget: null,
    stoppedAt: null,
    estimated: false,
    ...over,
  };
}
