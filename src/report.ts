export interface CostParts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface TokenParts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One user prompt and every model call it led to, up to the next user prompt. */
export interface TurnRow {
  /** 1-based; 0 is usage recorded before the first user prompt. */
  n: number;
  at: number;
  endAt: number;
  /** The prompt's first characters on one line, or "" when it had no text. */
  prompt: string;
  calls: number;
  cost: number;
  tokens: TokenParts;
  /** The last CALL_COSTS_MAX call costs of the turn, in order. */
  callCosts: number[];
  /** The most-used tools, by count. */
  tools: { name: string; count: number }[];
  /** provider/model keys the turn's calls used. */
  models: string[];
}

/** Spend on one local calendar day, YYYY-MM-DD. */
export interface DayRow {
  day: string;
  cost: number;
  calls: number;
  models: { key: string; cost: number }[];
}

export interface UsageReport {
  version: 2;
  startedAt: number;
  updatedAt: number;
  calls: number;
  lastTurnCost: number;
  tokens: TokenParts & { reasoning: number };
  cost: CostParts;
  cacheHitPct: number | null;
  context: { tokens: number | null; window: number; percent: number | null } | null;
  byModel: { key: string; cost: number; tokens: number; calls: number }[];
  /** The last SERIES_MAX calls; `turn` is the TurnRow.n the call belongs to. */
  series: { at: number; cost: number; tokens: number; turn: number }[];
  /** Every turn so far, including those no longer in `turns`. */
  turnCount: number;
  turns: TurnRow[];
  days: DayRow[];
  /** Set by the pi extension: true while pi is working on a prompt. */
  running: boolean;
  /** Set by the pi extension: the thread budget pi itself knows of (`/burn budget`), in dollars. */
  budget: number | null;
  /** Set by the pi extension: when Burn last stopped a run at the budget (only with stop at budget on). */
  stoppedAt: number | null;
}

/** Structural on purpose: pi's SessionEntry interfaces are assignable, and tests use plain objects. */
export type EntryLike = { type: string; timestamp: string };

export const REPORT_VERSION = 2;
export const SERIES_MAX = 60;
export const MODELS_MAX = 8;
export const TURNS_MAX = 50;
export const DAYS_MAX = 60;
export const PROMPT_MAX = 120;
export const CALL_COSTS_MAX = 30;
export const TURN_TOOLS_MAX = 6;
export const TURN_MODELS_MAX = 3;
export const DAY_MODELS_MAX = 4;
export const TOOLS_KEY = "Tools/summaries";
export const OTHER_KEY = "Other";

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

type Block = { type?: string; text?: string; name?: string };

interface Loose {
  type: string;
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    responseModel?: string;
    usage?: Usage;
    content?: string | Block[];
  };
  usage?: Usage;
  provider?: string;
  model?: string;
}

interface TurnDraft extends TurnRow {
  toolCounts: Map<string, number>;
}

const tokensOf = (u: TokenParts): number => u.input + u.output + u.cacheRead + u.cacheWrite;

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

/** The first PROMPT_MAX characters of a user message's text, whitespace collapsed. */
export function promptExcerpt(content: string | Block[] | undefined): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b?.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join(" ")
        : "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PROMPT_MAX ? `${flat.slice(0, PROMPT_MAX - 1)}…` : flat;
}

/** The local calendar day of a timestamp, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function foldDayModels(models: Map<string, number>): DayRow["models"] {
  const sorted = [...models.entries()].filter(([, cost]) => cost > 0).sort((a, b) => b[1] - a[1]);
  const rows = sorted.map(([key, cost]) => ({ key, cost }));
  if (rows.length <= DAY_MODELS_MAX) return rows;
  const other = rows.slice(DAY_MODELS_MAX - 1).reduce((sum, r) => sum + r.cost, 0);
  return [...rows.slice(0, DAY_MODELS_MAX - 1), { key: OTHER_KEY, cost: other }];
}

function newTurn(n: number, at: number, prompt: string): TurnDraft {
  return {
    n,
    at,
    endAt: at,
    prompt,
    calls: 0,
    cost: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    callCosts: [],
    tools: [],
    models: [],
    toolCounts: new Map(),
  };
}

function finishTurn({ toolCounts, ...turn }: TurnDraft): TurnRow {
  const tools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TURN_TOOLS_MAX)
    .map(([name, count]) => ({ name, count }));
  return { ...turn, tools };
}

function countTools(turn: TurnDraft, content: string | Block[] | undefined): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === "toolCall" && typeof block.name === "string") {
      turn.toolCounts.set(block.name, (turn.toolCounts.get(block.name) ?? 0) + 1);
    }
  }
}

export function buildReport(entries: readonly EntryLike[], context: UsageReport["context"] | undefined): UsageReport {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const cost: CostParts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const models = new Map<string, Row>();
  const series: UsageReport["series"] = [];
  const turns: TurnRow[] = [];
  const days = new Map<string, { cost: number; calls: number; models: Map<string, number> }>();
  let turn: TurnDraft | null = null;
  let turnCount = 0;
  let calls = 0;
  let lastTurnCost = 0;
  let startedAt = 0;
  let updatedAt = 0;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as Loose & EntryLike;
    const parsed = Date.parse(entry.timestamp);
    const at = Number.isFinite(parsed) ? parsed : updatedAt;
    if (index === 0) startedAt = at;
    updatedAt = at;

    if (entry.type === "message" && entry.message?.role === "user") {
      lastTurnCost = 0;
      if (turn) turns.push(finishTurn(turn));
      turnCount++;
      turn = newTurn(turnCount, at, promptExcerpt(entry.message.content));
      continue;
    }
    const counted = classify(entry);
    if (!counted) continue;
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

    const current: TurnDraft = turn ?? (turn = newTurn(0, at, ""));
    current.endAt = at;
    current.cost += usage.cost.total;
    current.tokens.input += usage.input;
    current.tokens.output += usage.output;
    current.tokens.cacheRead += usage.cacheRead;
    current.tokens.cacheWrite += usage.cacheWrite;

    const day = days.get(dayKey(at)) ?? { cost: 0, calls: 0, models: new Map<string, number>() };
    day.cost += usage.cost.total;
    day.models.set(key, (day.models.get(key) ?? 0) + usage.cost.total);
    days.set(dayKey(at), day);

    if (call) {
      row.calls++;
      calls++;
      day.calls++;
      series.push({ at, cost: usage.cost.total, tokens: tokensOf(usage), turn: current.n });
      current.calls++;
      current.callCosts.push(usage.cost.total);
      if (current.callCosts.length > CALL_COSTS_MAX) current.callCosts.shift();
      if (!current.models.includes(key) && current.models.length < TURN_MODELS_MAX) current.models.push(key);
      countTools(current, entry.message?.content);
    }
  }
  if (turn) turns.push(finishTurn(turn));

  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const dayRows = [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-DAYS_MAX)
    .map(([key, d]) => ({ day: key, cost: d.cost, calls: d.calls, models: foldDayModels(d.models) }));
  return {
    version: REPORT_VERSION,
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
    turnCount,
    turns: turns.slice(-TURNS_MAX),
    days: dayRows,
    running: false,
    budget: null,
    stoppedAt: null,
  };
}
