import { z } from "zod";
import {
  CALL_COSTS_MAX,
  DAY_MODELS_MAX,
  DAYS_MAX,
  MODELS_MAX,
  PROMPT_MAX,
  SERIES_MAX,
  TURN_MODELS_MAX,
  TURN_TOOLS_MAX,
  TURNS_MAX,
  type UsageReport,
} from "../../src/report.js";

export const THREAD_ID = /^thr_[0-9a-z]{6,40}$/;

const amount = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const key = z.string().max(200);
const cost = z.object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, total: amount });
const tokenParts = z.object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount });

const turnSchema = z.object({
  n: count,
  at: amount,
  endAt: amount,
  // An excerpt from an older or newer extension may be longer; keep it bounded rather than reject the report.
  prompt: z.string().transform((s) => s.slice(0, PROMPT_MAX)),
  calls: count,
  cost: amount,
  tokens: tokenParts,
  callCosts: z.array(amount).max(CALL_COSTS_MAX),
  tools: z.array(z.object({ name: key, count })).max(TURN_TOOLS_MAX),
  models: z.array(key).max(TURN_MODELS_MAX),
});

const daySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost: amount,
  calls: count,
  models: z.array(z.object({ key, cost: amount })).max(DAY_MODELS_MAX),
});

const common = {
  startedAt: amount,
  updatedAt: amount,
  calls: count,
  lastTurnCost: amount,
  tokens: z.object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, reasoning: amount }),
  cost,
  cacheHitPct: z.number().finite().nullable(),
  context: z.object({ tokens: amount.nullable(), window: amount, percent: z.number().finite().nullable() }).nullable(),
  byModel: z.array(z.object({ key, cost: amount, tokens: amount, calls: count })).max(MODELS_MAX),
};

/** What Burn 0.1 extensions send; upgraded to version 2 with empty turns and days. */
const v1Schema = z.object({
  ...common,
  version: z.literal(1),
  series: z.array(z.object({ at: amount, cost: amount, tokens: amount })).max(SERIES_MAX),
});

const v2Schema = z.object({
  ...common,
  version: z.literal(2),
  series: z.array(z.object({ at: amount, cost: amount, tokens: amount, turn: count })).max(SERIES_MAX),
  turnCount: count,
  turns: z.array(turnSchema).max(TURNS_MAX),
  days: z.array(daySchema).max(DAYS_MAX),
  running: z.boolean(),
  budget: z.number().finite().positive().nullable(),
  stoppedAt: amount.nullable(),
});

/**
 * Mirrors src/report.ts#UsageReport and always yields version 2. Not strict,
 * so a newer extension's extra fields are dropped.
 */
export const usageReportSchema: z.ZodType<UsageReport, unknown> = z.union([
  v2Schema,
  v1Schema.transform(
    (r): UsageReport => ({
      ...r,
      version: 2,
      series: r.series.map((p) => ({ ...p, turn: 0 })),
      turnCount: 0,
      turns: [],
      days: [],
      running: false,
      budget: null,
      stoppedAt: null,
    }),
  ),
]);

export const usageEnvelopeSchema = z.object({
  threadId: z.string().regex(THREAD_ID),
  sentAt: count,
  report: usageReportSchema,
});

/** A thread's latest report as the plugin keeps it: `sentAt` from pi, `at` when bb received it. */
export const storedSchema = z.object({ report: usageReportSchema, sentAt: z.number(), at: z.number() });
export type Stored = z.infer<typeof storedSchema>;

export const policySchema = z.object({
  budget: z.number().finite().positive().nullable(),
  stopAtBudget: z.boolean(),
  notifyExpensiveTurn: z.boolean(),
});
