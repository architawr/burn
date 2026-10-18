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

/** Spend on one calendar day, YYYY-MM-DD. */
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
  /** Local calendar days: the process zone's, or `opts.timeZone`'s. */
  days: DayRow[];
  /** The same spend by UTC calendar day. */
  utcDays: DayRow[];
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

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of a timestamp, YYYY-MM-DD, in `timeZone` (an IANA zone such as "UTC") or else the process zone. */
export function dayKey(ms: number, timeZone?: string): string {
  if (timeZone !== undefined) {
    let format = dayFormats.get(timeZone);
    if (!format) {
      format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
      dayFormats.set(timeZone, format);
    }
    return format.format(ms);
  }
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * When a forked session (a side chat, `/fork`) was created: its header names a
 * parent session. Its log starts with a copy of the parent's entries, which keep
 * their older timestamps, so only entries from this time on are its own.
 */
export function forkedAt(header: unknown): number | null {
  if (!isRecord(header) || typeof header.parentSession !== "string" || header.parentSession === "") return null;
  const at = typeof header.timestamp === "string" ? Date.parse(header.timestamp) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

function slimUsage(usage: unknown): Usage | undefined {
  if (!isRecord(usage) || !isRecord(usage.cost)) return undefined;
  const { cost } = usage;
  return {
    input: usage.input as number,
    output: usage.output as number,
    cacheRead: usage.cacheRead as number,
    cacheWrite: usage.cacheWrite as number,
    reasoning: usage.reasoning as number | undefined,
    cost: {
      input: cost.input as number,
      output: cost.output as number,
      cacheRead: cost.cacheRead as number,
      cacheWrite: cost.cacheWrite as number,
      total: cost.total as number,
    },
  };
}

/**
 * A session log entry cut down to what buildReport reads, so a reader that keeps
 * many logs in memory holds kilobytes rather than every prompt and tool output.
 * null for the session header and for anything that is not an entry.
 */
export function slimEntry(entry: unknown): EntryLike | null {
  if (!isRecord(entry) || typeof entry.type !== "string" || typeof entry.timestamp !== "string" || entry.type === "session") return null;
  const slim: Loose & EntryLike = { type: entry.type, timestamp: entry.timestamp };
  const usage = slimUsage(entry.usage);
  if (usage) slim.usage = usage;
  if (entry.type === "usage") {
    slim.provider = entry.provider as string;
    slim.model = entry.model as string;
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    const { role, provider, model, responseModel, content } = entry.message as NonNullable<Loose["message"]>;
    const message: NonNullable<Loose["message"]> = { role };
    if (provider !== undefined) message.provider = provider;
    if (model !== undefined) message.model = model;
    if (responseModel !== undefined) message.responseModel = responseModel;
    const messageUsage = slimUsage(entry.message.usage);
    if (messageUsage) message.usage = messageUsage;
    if (role === "user") message.content = promptExcerpt(content);
    else if (Array.isArray(content)) {
      const calls = content.filter((b) => b?.type === "toolCall" && typeof b.name === "string").map((b) => ({ type: "toolCall", name: b.name }));
      if (calls.length > 0) message.content = calls;
    }
    slim.message = message;
  }
  return slim;
}

interface DayDraft {
  cost: number;
  calls: number;
  models: Map<string, number>;
}

function addDay(days: Map<string, DayDraft>, day: string, key: string, cost: number, call: boolean): void {
  const draft = days.get(day) ?? { cost: 0, calls: 0, models: new Map<string, number>() };
  draft.cost += cost;
  draft.models.set(key, (draft.models.get(key) ?? 0) + cost);
  if (call) draft.calls++;
  days.set(day, draft);
}

const dayRows = (days: Map<string, DayDraft>): DayRow[] =>
  [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-DAYS_MAX)
    .map(([day, d]) => ({ day, cost: d.cost, calls: d.calls, models: foldDayModels(d.models) }));

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

export interface ReportOptions {
  /** Count only entries from this time on: a forked session's `forkedAt`. */
  countFrom?: number | null;
  /** The IANA zone whose calendar days `days` uses; the process zone when undefined. */
  timeZone?: string;
}

export function buildReport(
  entries: readonly EntryLike[],
  context: UsageReport["context"] | undefined,
  opts: ReportOptions = {},
): UsageReport {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const cost: CostParts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const models = new Map<string, Row>();
  const series: UsageReport["series"] = [];
  const turns: TurnRow[] = [];
  const days = new Map<string, DayDraft>();
  const utcDays = new Map<string, DayDraft>();
  const countFrom = opts.countFrom ?? null;
  let turn: TurnDraft | null = null;
  let turnCount = 0;
  let calls = 0;
  let lastTurnCost = 0;
  let started = false;
  let startedAt = 0;
  let updatedAt = 0;

  for (const item of entries) {
    const entry = item as Loose & EntryLike;
    const parsed = Date.parse(entry.timestamp);
    if (countFrom !== null && parsed < countFrom) continue;
    const at = Number.isFinite(parsed) ? parsed : updatedAt;
    if (!started) {
      started = true;
      startedAt = at;
    }
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

    addDay(days, dayKey(at, opts.timeZone), key, usage.cost.total, call);
    addDay(utcDays, dayKey(at, "UTC"), key, usage.cost.total, call);

    if (call) {
      row.calls++;
      calls++;
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
    days: dayRows(days),
    utcDays: dayRows(utcDays),
    running: false,
    budget: null,
    stoppedAt: null,
  };
}
