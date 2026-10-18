import { describe, expect, it } from "vitest";
import { budgetAlert, budgetFraction, budgetState, isExpensiveTurn, parseBudget, QUIET_POLICY, shouldStop } from "../src/budget.js";
import { sampleReport } from "./helpers.js";

describe("budgetState", () => {
  it("is none without a budget and turns near at 80%", () => {
    expect(budgetState(5, null)).toBe("none");
    expect(budgetState(5, 0)).toBe("none");
    expect(budgetState(7.99, 10)).toBe("ok");
    expect(budgetState(8, 10)).toBe("near");
    expect(budgetState(10, 10)).toBe("over");
    expect(budgetFraction(4.82, 10)).toBeCloseTo(0.482);
    expect(budgetFraction(1, null)).toBeNull();
  });
});

describe("budgetAlert", () => {
  it("fires once per threshold crossed", () => {
    expect(budgetAlert(7, 8.5, 10)).toBe("near");
    expect(budgetAlert(8.5, 9, 10)).toBeNull();
    expect(budgetAlert(9, 10.2, 10)).toBe("over");
    expect(budgetAlert(7, 12, 10)).toBe("over");
    expect(budgetAlert(11, 12, 10)).toBeNull();
    expect(budgetAlert(5, 4, 10)).toBeNull();
    expect(budgetAlert(1, 20, null)).toBeNull();
  });
});

describe("shouldStop", () => {
  it("never stops with the default policy", () => {
    expect(QUIET_POLICY.stopAtBudget).toBe(false);
    expect(shouldStop({ ...QUIET_POLICY, budget: 10 }, 9, 11)).toBe(false);
  });

  it("stops only the run that crosses the budget when turned on", () => {
    const policy = { ...QUIET_POLICY, budget: 10, stopAtBudget: true };
    expect(shouldStop(policy, 9, 10.5)).toBe(true);
    expect(shouldStop(policy, 10.5, 11)).toBe(false);
    expect(shouldStop(policy, 5, 8.5)).toBe(false);
    expect(shouldStop({ ...policy, budget: null }, 9, 11)).toBe(false);
  });
});

describe("isExpensiveTurn", () => {
  it("needs three times the median and fifty cents", () => {
    const { turns } = sampleReport();
    expect(isExpensiveTurn(turns[1]!, turns)).toBe(true);
    expect(isExpensiveTurn(turns[0]!, turns)).toBe(false);
    const cheap = { ...turns[1]!, cost: 0.4 };
    expect(isExpensiveTurn(cheap, [...turns.slice(0, 1), cheap, ...turns.slice(2)])).toBe(false);
  });
});

describe("parseBudget", () => {
  it("reads dollars and clears on off, none, 0 or empty", () => {
    expect(parseBudget("10")).toBe(10);
    expect(parseBudget(" $7.50 ")).toBe(7.5);
    expect(parseBudget("off")).toBeNull();
    expect(parseBudget("0")).toBeNull();
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("ten")).toBeUndefined();
    expect(parseBudget("-3")).toBeUndefined();
    expect(parseBudget("1.234")).toBeUndefined();
  });
});
