/** Plugin KV keys. A thread's latest report: `Stored` from schema.ts. */
export const REPORT_PREFIX = "report:";
export const reportKey = (threadId: string): string => `${REPORT_PREFIX}${threadId}`;

/** A thread's own budget, overriding the Thread budget setting: `{ budget: number | null }`, null meaning none. */
export const BUDGET_PREFIX = "budget:";
export const budgetKey = (threadId: string): string => `${BUDGET_PREFIX}${threadId}`;

/** The last report a host read from a thread's pi session logs, for when that host is offline: `{ report, at }`. */
export const logKey = (threadId: string): string => `log:${threadId}`;

/** When Burn last stopped a thread at its budget through bb: `{ at }`. */
export const stoppedKey = (threadId: string): string => `stopped:${threadId}`;

/** Which Burn page panels are hidden: { hidden: SpendPanel[] }. */
export const SPEND_PANELS_KEY = "spend-panels";

/** Burn's own copy of its settings, which bb's settings store does not survive a plugin removal: `Record<setting, value>`. */
export const SETTINGS_COPY_KEY = "settings-copy";
