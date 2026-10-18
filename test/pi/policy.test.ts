import { describe, expect, it } from "vitest";
import { BUDGET_ENTRY, describeBudget, effectivePolicy, ownBudget, threadBudget } from "../../extensions/pi/policy.js";
import { DEFAULT_SETTINGS } from "../../extensions/pi/settings.js";
import { QUIET_POLICY } from "../../src/budget.js";
import { assistant, user } from "../helpers.js";

const budgetEntry = (budget: unknown) => ({ type: "custom", customType: BUDGET_ENTRY, timestamp: new Date().toISOString(), data: { budget } });
const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe("threadBudget", () => {
  it("is undefined until /burn budget was used, and the latest entry wins", () => {
    expect(threadBudget([user(), assistant(1)])).toBeUndefined();
    expect(threadBudget([budgetEntry(10), user(), budgetEntry(4)])).toBe(4);
    expect(threadBudget([budgetEntry(10), budgetEntry(null)])).toBeNull();
  });

  it("skips malformed and foreign entries", () => {
    const foreign = { type: "custom", customType: "other", timestamp: "", data: { budget: 3 } };
    expect(threadBudget([budgetEntry(5), budgetEntry("ten"), budgetEntry(-2), foreign, { type: "custom", customType: BUDGET_ENTRY }])).toBe(5);
  });
});

describe("ownBudget", () => {
  it("prefers the thread's budget, lets null turn a default off, and falls back to the default", () => {
    expect(ownBudget(4, settings({ defaultBudget: 10 }))).toBe(4);
    expect(ownBudget(null, settings({ defaultBudget: 10 }))).toBeNull();
    expect(ownBudget(undefined, settings({ defaultBudget: 10 }))).toBe(10);
    expect(ownBudget(undefined, settings())).toBeNull();
  });
});

describe("effectivePolicy", () => {
  it("is quiet by default in a terminal", () => {
    expect(effectivePolicy(null, undefined, settings())).toEqual(QUIET_POLICY);
  });

  it("uses burn.json in a terminal", () => {
    expect(effectivePolicy(null, 4, settings({ defaultBudget: 10, stopAtBudget: true, notifyExpensiveTurn: true }))).toEqual({
      budget: 4,
      stopAtBudget: true,
      notifyExpensiveTurn: true,
    });
  });

  it("takes bb's policy in a bb thread, with pi's own budget only when bb has none", () => {
    const bb = { budget: 20, stopAtBudget: false, notifyExpensiveTurn: true };
    const local = settings({ defaultBudget: 10, stopAtBudget: true });
    expect(effectivePolicy(bb, 4, local)).toEqual(bb);
    expect(effectivePolicy({ ...bb, budget: null }, 4, local)).toEqual({ ...bb, budget: 4 });
    expect(effectivePolicy({ ...bb, budget: null }, undefined, local)).toEqual({ ...bb, budget: 10 });
    expect(effectivePolicy({ ...bb, budget: null }, null, local)).toEqual({ ...bb, budget: null });
  });
});

describe("describeBudget", () => {
  it("names where the budget in effect comes from", () => {
    const bb = { budget: 20, stopAtBudget: false, notifyExpensiveTurn: false };
    expect(describeBudget(bb, 4, settings())).toContain("$20, set in bb");
    expect(describeBudget(null, 4, settings({ defaultBudget: 10 }))).toContain("$4, set for this thread");
    expect(describeBudget(null, null, settings({ defaultBudget: 10 }))).toContain("No budget: turned off for this thread");
    expect(describeBudget(null, undefined, settings({ defaultBudget: 10 }))).toContain("$10, the default");
    expect(describeBudget(null, undefined, settings())).toContain("No budget.");
  });

  it("says whether Burn stops at the budget, off by default", () => {
    expect(describeBudget(null, 4, settings())).toContain("Burn warns at 80% and 100% and never stops a run");
    expect(describeBudget(null, 4, settings({ stopAtBudget: true }))).toContain("stops the run that crosses it");
  });
});
