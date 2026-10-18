export interface CostParts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageReport {
  version: 1;
  startedAt: number;
  updatedAt: number;
  calls: number;
  lastTurnCost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };
  cost: CostParts;
  cacheHitPct: number | null;
  context: { tokens: number | null; window: number; percent: number | null } | null;
  byModel: { key: string; cost: number; tokens: number; calls: number }[];
  series: { at: number; cost: number; tokens: number }[];
}

/** Structural on purpose: pi's SessionEntry interfaces are assignable, and tests use plain objects. */
export type EntryLike = { type: string; timestamp: string };

export const SERIES_MAX = 60;
export const MODELS_MAX = 8;
const TOOLS_KEY = "Tools/summaries";
const OTHER_KEY = "Other";

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  cost: CostParts;
}

interface Row {
  key: string;
  cost: number;
  tokens: number;
  calls: number;
}

interface Counted {
  usage: Usage;
  key: string;
  call: boolean;
}

interface Loose {
  type: string;
  message?: { role?: string; provider?: string; model?: string; responseModel?: string; usage?: Usage };
  usage?: Usage;
  provider?: string;
  model?: string;
}

const tokensOf = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheWrite;

function classify(entry: Loose): Counted | null {
  const { message } = entry;
  if (entry.type === "message" && message?.role === "assistant" && message.usage) {
    return { usage: message.usage, key: `${message.provider}/${message.responseModel ?? message.model}`, call: true };
  }
  if (entry.type === "usage" && entry.usage) {
    return { usage: entry.usage, key: `${entry.provider}/${entry.model}`, call: false };
  }
  if (entry.type === "message" && message?.role === "toolResult" && message.usage) {
    return { usage: message.usage, key: TOOLS_KEY, call: false };
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
    return { usage: entry.usage, key: TOOLS_KEY, call: false };
  }
  return null;
}

function foldModels(rows: Map<string, Row>): Row[] {
  const sorted = [...rows.values()].filter((r) => r.cost > 0 || r.tokens > 0).sort((a, b) => b.cost - a.cost);
  if (sorted.length <= MODELS_MAX) return sorted;
  const head = sorted.slice(0, MODELS_MAX - 1);
  const other: Row = { key: OTHER_KEY, cost: 0, tokens: 0, calls: 0 };
  for (const r of sorted.slice(MODELS_MAX - 1)) {
    other.cost += r.cost;
    other.tokens += r.tokens;
    other.calls += r.calls;
  }
  return [...head, other];
}

export function buildReport(entries: readonly EntryLike[], context: UsageReport["context"] | undefined): UsageReport {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const cost: CostParts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const models = new Map<string, Row>();
  const series: UsageReport["series"] = [];
  let calls = 0;
  let lastTurnCost = 0;
  let startedAt = 0;
  let updatedAt = 0;

  entries.forEach((raw, index) => {
    const entry = raw as Loose & EntryLike;
    const parsed = Date.parse(entry.timestamp);
    const at = Number.isFinite(parsed) ? parsed : updatedAt;
    if (index === 0) startedAt = at;
    updatedAt = at;

    if (entry.type === "message" && entry.message?.role === "user") lastTurnCost = 0;
    const counted = classify(entry);
    if (!counted) return;
    const { usage, key, call } = counted;

    tokens.input += usage.input;
    tokens.output += usage.output;
    tokens.cacheRead += usage.cacheRead;
    tokens.cacheWrite += usage.cacheWrite;
    tokens.reasoning += usage.reasoning ?? 0;
    cost.input += usage.cost.input;
    cost.output += usage.cost.output;
    cost.cacheRead += usage.cost.cacheRead;
    cost.cacheWrite += usage.cost.cacheWrite;
    cost.total += usage.cost.total;
    lastTurnCost += usage.cost.total;

    const row = models.get(key) ?? { key, cost: 0, tokens: 0, calls: 0 };
    row.cost += usage.cost.total;
    row.tokens += tokensOf(usage);
    models.set(key, row);
    if (call) {
      row.calls++;
      calls++;
      series.push({ at, cost: usage.cost.total, tokens: tokensOf(usage) });
    }
  });

  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return {
    version: 1,
    startedAt,
    updatedAt,
    calls,
    lastTurnCost,
    tokens,
    cost,
    cacheHitPct: prompt > 0 ? (tokens.cacheRead / prompt) * 100 : null,
    context: context ?? null,
    byModel: foldModels(models),
    series: series.slice(-SERIES_MAX),
  };
}
