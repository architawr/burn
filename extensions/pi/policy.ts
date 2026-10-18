import { type BudgetPolicy, NEAR_FRACTION } from "../../src/budget.js";
import { formatBudget } from "../../src/format.js";
import type { BurnSettings } from "./settings.js";

/** The custom session entry `/burn budget` appends: `{ budget: number | null }`. */
export const BUDGET_ENTRY = "burn-budget";

type Loose = { type?: unknown; customType?: unknown; data?: unknown };

const validBudget = (b: unknown): b is number | null => b === null || (typeof b === "number" && Number.isFinite(b) && b > 0);

/** This thread's own budget: the latest valid entry, null when turned off, undefined when never set. */
export function threadBudget(entries: readonly unknown[]): number | null | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as Loose;
    if (entry?.type !== "custom" || entry.customType !== BUDGET_ENTRY) continue;
    const budget = (entry.data as { budget?: unknown } | undefined)?.budget;
    if (validBudget(budget)) return budget;
  }
  return undefined;
}

/** The budget pi itself knows of: the thread's, else the default from burn.json. */
export const ownBudget = (thread: number | null | undefined, settings: BurnSettings): number | null =>
  thread === undefined ? settings.defaultBudget : thread;

/**
 * The policy in effect. In a bb thread that has answered, bb's policy, with pi's
 * own budget only when bb has none; otherwise burn.json's.
 */
export function effectivePolicy(bb: BudgetPolicy | null, thread: number | null | undefined, settings: BurnSettings): BudgetPolicy {
  if (bb) return { ...bb, budget: bb.budget ?? ownBudget(thread, settings) };
  return { budget: ownBudget(thread, settings), stopAtBudget: settings.stopAtBudget, notifyExpensiveTurn: settings.notifyExpensiveTurn };
}

/** `/burn budget` with no amount: the budget in effect, where it comes from and what it does. */
export function describeBudget(bb: BudgetPolicy | null, thread: number | null | undefined, settings: BurnSettings): string {
  const policy = effectivePolicy(bb, thread, settings);
  let source: string;
  if (bb?.budget != null) source = `${formatBudget(bb.budget)}, set in bb.`;
  else if (typeof thread === "number") source = `${formatBudget(thread)}, set for this thread with /burn budget.`;
  else if (thread === null) source = "No budget: turned off for this thread with /burn budget off.";
  else if (settings.defaultBudget !== null) source = `${formatBudget(settings.defaultBudget)}, the default from /burn budget default.`;
  else source = "No budget. /burn budget 10 sets one for this thread; /burn budget default 10 sets one for every thread.";
  const lines = [`Budget: ${source}`];
  if (policy.budget !== null) {
    const near = Math.round(NEAR_FRACTION * 100);
    lines.push(
      policy.stopAtBudget
        ? `Burn warns at ${near}% and 100%, and stops the run that crosses it (stop at budget is on in /burn settings).`
        : `Burn warns at ${near}% and 100% and never stops a run. Stopping at the budget is off by default; /burn settings turns it on.`,
    );
  }
  return lines.join("\n");
}
