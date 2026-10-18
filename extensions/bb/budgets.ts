import type { BudgetPolicy } from "../../src/budget.js";
import { formatBudget, formatUsd } from "../../src/format.js";

export type BudgetSource = "thread" | "setting" | "pi";

/** The budget that applies to a thread and where it comes from. */
export interface EffectiveBudget {
  amount: number;
  source: BudgetSource;
}

/**
 * A thread's own budget as stored under `budgetKey`: dollars, null for "no
 * budget" (which also overrides the Thread budget setting), or undefined when
 * the thread has none of its own.
 */
export type OwnBudget = number | null | undefined;

export const positiveOrNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

/** The budget bb hands pi: the thread's own, else the setting. An explicit null means none, setting or not. */
export const bbBudget = (own: OwnBudget, setting: unknown): number | null =>
  own === undefined ? positiveOrNull(setting) : own;

/** bb's budget for the thread, else the one pi reported (`/burn budget`), as pi itself applies them. */
export function effectiveBudget(own: OwnBudget, setting: unknown, pi: number | null): EffectiveBudget | null {
  const fromBb = bbBudget(own, setting);
  if (fromBb !== null) return { amount: fromBb, source: own === undefined ? "setting" : "thread" };
  const fromPi = positiveOrNull(pi);
  return fromPi === null ? null : { amount: fromPi, source: "pi" };
}

export function policyFor(
  own: OwnBudget,
  settings: { threadBudget?: unknown; stopAtBudget: boolean; notifyExpensiveTurn: boolean },
): BudgetPolicy {
  return {
    budget: bbBudget(own, settings.threadBudget),
    stopAtBudget: settings.stopAtBudget,
    notifyExpensiveTurn: settings.notifyExpensiveTurn,
  };
}

/** "48% of the $10 thread budget" and "$5.18 left" (or "$2.40 over"). */
export function budgetWords(cost: number, budget: EffectiveBudget): { share: string; left: string } {
  const noun = budget.source === "pi" ? "budget set in pi" : "thread budget";
  const rest = budget.amount - cost;
  return {
    share: `${Math.round((cost / budget.amount) * 100)}% of the ${formatBudget(budget.amount)} ${noun}`,
    left: rest >= 0 ? `${formatUsd(rest)} left` : `${formatUsd(-rest)} over`,
  };
}
