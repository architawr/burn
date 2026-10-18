import { z } from "zod";
import type { UsageReport } from "../../src/report.js";

export const THREAD_ID = /^thr_[0-9a-z]{6,40}$/;

const amount = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const cost = z.object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, total: amount });

/** Mirrors src/report.ts#UsageReport; not strict, so a newer extension's extra fields are dropped. */
export const usageReportSchema: z.ZodType<UsageReport> = z.object({
  version: z.literal(1),
  startedAt: amount,
  updatedAt: amount,
  calls: count,
  lastTurnCost: amount,
  tokens: z.object({ input: amount, output: amount, cacheRead: amount, cacheWrite: amount, reasoning: amount }),
  cost,
  cacheHitPct: z.number().finite().nullable(),
  context: z
    .object({ tokens: amount.nullable(), window: amount, percent: z.number().finite().nullable() })
    .nullable(),
  byModel: z.array(z.object({ key: z.string().max(200), cost: amount, tokens: amount, calls: count })).max(8),
  series: z.array(z.object({ at: amount, cost: amount, tokens: amount })).max(60),
});

export const usageEnvelopeSchema = z.object({
  threadId: z.string().regex(THREAD_ID),
  sentAt: count,
  report: usageReportSchema,
});
