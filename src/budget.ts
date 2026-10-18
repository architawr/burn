import { turnMultiple } from "./format.js";
import type { TurnRow } from "./report.js";

/** Where a thread stands against its budget. "near" starts at NEAR_FRACTION of it. */
export type BudgetState = "none" | "ok" | "near" | "over";

export const NEAR_FRACTION = 0.8;
/** A turn is expensive when it costs this many times the thread's median turn… */
export const EXPENSIVE_MULTIPLE = 3;
/** …and at least this much, so cheap threads never nudge. */
export const EXPENSIVE_MIN_USD = 0.5;

/**
 * What a thread's budget does. Burn never stops a thread unless `stopAtBudget`
 * was turned on; every default here is the quiet one.
 */
export interface BudgetPolicy {
  /** Dollars, or null for no budget. */
  budget: number | null;
  /** Abort the pi run whose cost crosses the budget. */
  stopAtBudget: boolean;
  /** Notify after a turn that costs EXPENSIVE_MULTIPLE times the median turn. */
  notifyExpensiveTurn: boolean;
}

export const QUIET_POLICY: BudgetPolicy = { budget: null, stopAtBudget: false, notifyExpensiveTurn: false };

const isBudget = (b: number | null | undefined): b is number => typeof b === "number" && Number.isFinite(b) && b > 0;

export function budgetState(cost: number, budget: number | null | undefined): BudgetState {
  if (!isBudget(budget)) return "none";
  if (cost >= budget) return "over";
  return cost >= budget * NEAR_FRACTION ? "near" : "ok";
}

/** The fraction of the budget spent, unclamped; null without a budget. */
export const budgetFraction = (cost: number, budget: number | null | undefined): number | null =>
  isBudget(budget) ? cost / budget : null;

/**
 * The alert a cost change earns, once per threshold: "over" when it crosses the
 * budget, "near" when it crosses NEAR_FRACTION of it without reaching it.
 */
export function budgetAlert(prevCost: number, cost: number, budget: number | null | undefined): "near" | "over" | null {
  if (!isBudget(budget) || cost <= prevCost) return null;
  if (prevCost < budget && cost >= budget) return "over";
  const near = budget * NEAR_FRACTION;
  return prevCost < near && cost >= near ? "near" : null;
}

/**
 * Whether to abort the current run: only with `stopAtBudget` on, and only for
 * the run whose cost crosses the budget. A thread already over its budget is
 * never stopped again, so the user can keep going on purpose.
 */
export const shouldStop = (policy: BudgetPolicy, prevCost: number, cost: number): boolean =>
  policy.stopAtBudget && budgetAlert(prevCost, cost, policy.budget) === "over";

/** Whether a finished turn deserves the "unusually expensive" nudge. */
export function isExpensiveTurn(turn: TurnRow, turns: readonly TurnRow[]): boolean {
  if (turn.cost < EXPENSIVE_MIN_USD) return false;
  const multiple = turnMultiple(turn, turns);
  return multiple !== null && multiple >= EXPENSIVE_MULTIPLE;
}

/**
 * Reads a budget a person typed: "10", "$7.50" and "7.5" are dollars; "off",
 * "none", "0" and "" clear it (null); anything else is undefined.
 */
export function parseBudget(input: string): number | null | undefined {
  const text = input.trim().toLowerCase();
  if (text === "" || text === "off" || text === "none" || text === "clear") return null;
  const match = /^\$?\s*(\d+(?:\.\d{1,2})?)$/.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value > 1_000_000) return undefined;
  return value === 0 ? null : value;
}
