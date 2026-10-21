import { CALL_TIME_BUCKETS, type DayRow, type ModelRow, type TurnRow, type UsageReport } from "../src/report.js";

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

export const assistant = (
  total: number,
  model = "m1",
  tokens: CostIn = {},
  provider = "p",
  tools: string[] = [],
  extra: Record<string, unknown> = {},
) => ({
  type: "message",
  timestamp: stamp(),
  message: {
    role: "assistant",
    provider,
    model,
    usage: usage(total, tokens),
    content: tools.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: {} })),
    ...extra,
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
  ms: 0,
  timedOutput: 0,
});

/** A day row with these models' costs and every other detail zero. */
export function dayRow(day: string, cost: number, models: Record<string, number> = {}, calls = 0): DayRow {
  return {
    day,
    cost,
    calls,
    models: Object.entries(models).map(([key, c]) => ({ key, cost: c, calls: 0, tokens: 0 })),
    prompts: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    callTime: new Array<number>(CALL_TIME_BUCKETS).fill(0),
    failed: 0,
    aborted: 0,
  };
}

/** A byModel row with no token kinds or timing unless given. */
export const modelRow = (key: string, cost: number, tokens: number, calls: number, over: Partial<ModelRow> = {}): ModelRow => ({
  key,
  cost,
  tokens,
  calls,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  timed: 0,
  ms: 0,
  timedOutput: 0,
  failed: 0,
  ...over,
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
    byModel: [modelRow("p/claude-opus", 4.31, 1_500_000, 18), modelRow("p/claude-haiku", 0.51, 236_000, 5)],
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
    days: [dayRow("2026-10-18", 4.82, { "p/claude-opus": 4.31, "p/claude-haiku": 0.51 }, 23)],
    utcDays: [dayRow("2026-10-18", 4.82, { "p/claude-opus": 4.31, "p/claude-haiku": 0.51 }, 23)],
    hours: [],
    running: false,
    budget: null,
    stoppedAt: null,
    estimated: false,
    ...over,
  };
}
