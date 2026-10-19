import { z } from "zod";

// The Spend page's slice of the plugin's rpc contract. server.ts spreads it into the one contract it registers.

export const SPEND_RANGES = ["today", "7d", "30d"] as const;
export type SpendRange = (typeof SPEND_RANGES)[number];
/** Which calendar days count: the bb server's local ones, or UTC ones as Shopify's AI proxy counts them. */
export const SPEND_ZONES = ["local", "utc"] as const;
export type SpendZone = (typeof SPEND_ZONES)[number];

const amount = z.number().finite().nonnegative();

export const spendOutputSchema = z.object({
  range: z.enum(SPEND_RANGES),
  tz: z.enum(SPEND_ZONES),
  /** Days covered in `tz`, oldest first, YYYY-MM-DD. */
  days: z.array(z.object({ day: z.string(), cost: amount, models: z.array(z.object({ key: z.string(), cost: amount })) })),
  total: amount,
  /** The same length of time just before the range, for "▲ 18% vs previous 7 days". */
  previousTotal: amount,
  threadCount: z.number().int().nonnegative(),
  overBudgetCount: z.number().int().nonnegative(),
  medianThreadCost: amount.nullable(),
  perCall: amount.nullable(),
  cacheHitPct: z.number().finite().nullable(),
  threads: z.array(
    z.object({
      threadId: z.string(),
      title: z.string(),
      projectName: z.string().nullable(),
      model: z.string().nullable(),
      childCount: z.number().int().nonnegative(),
      calls: z.number().int().nonnegative(),
      rangeCost: amount,
      total: amount,
      budget: amount.nullable(),
      running: z.boolean(),
      estimated: z.boolean(),
    }),
  ),
  projects: z.array(z.object({ projectId: z.string().nullable(), name: z.string(), cost: amount })),
  models: z.array(z.object({ key: z.string(), cost: amount })),
  projectOptions: z.array(z.object({ projectId: z.string(), name: z.string() })),
  dailyBudget: amount.nullable(),
  /** Threads with a stored report in any project and at any time; 0 means no thread has reported. */
  reportedThreads: z.number().int().nonnegative(),
  /** Some counted spend is a list-price estimate. */
  estimated: z.boolean(),
});
export type SpendOutput = z.infer<typeof spendOutputSchema>;

export const spendMethods = {
  spend: {
    input: z.object({ range: z.enum(SPEND_RANGES), projectId: z.string().max(100).nullable(), tz: z.enum(SPEND_ZONES).default("local") }),
    output: spendOutputSchema,
  },
};
