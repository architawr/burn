/** Plugin KV keys. A thread's latest report: `Stored` from schema.ts. */
export const REPORT_PREFIX = "report:";
export const reportKey = (threadId: string): string => `${REPORT_PREFIX}${threadId}`;

/** A thread's own budget, overriding the Thread budget setting: `{ budget: number | null }`, null meaning none. */
export const BUDGET_PREFIX = "budget:";
export const budgetKey = (threadId: string): string => `${BUDGET_PREFIX}${threadId}`;
