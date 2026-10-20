import { type Discounts, hasDiscounts } from "../../src/discounts.js";

/** The plugin settings the app reads, with the defaults server.ts declares (test/bb/prefs.test.ts keeps them equal). */
export interface Prefs {
  chip: boolean;
  chipShows: "delta" | "cost";
  threadBudget: number | null;
  flagOverBudget: boolean;
  /** Some discount in Burn's settings is not 0. */
  discounted: boolean;
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const percent = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Each line item's discount: its own override when set, else the one discount for everything. */
export function discountsOf(values: Record<string, unknown> | undefined): Discounts {
  const v = values ?? {};
  const all = percent(v.discount, 0);
  return {
    input: percent(v.inputDiscount, all),
    output: percent(v.outputDiscount, all),
    cacheRead: percent(v.cacheReadDiscount, all),
    cacheWrite: percent(v.cacheWriteDiscount, all),
  };
}

export function readPrefs(values: Record<string, unknown> | undefined): Prefs {
  const v = values ?? {};
  const budget = v.threadBudget;
  return {
    chip: flag(v.chip, true),
    chipShows: v.chipShows === "cost" ? "cost" : "delta",
    threadBudget: typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? budget : null,
    flagOverBudget: flag(v.flagOverBudget, true),
    discounted: hasDiscounts(discountsOf(v)),
  };
}
