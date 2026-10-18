import { describe, expect, it } from "vitest";
import { readPolicy } from "../src/wire.js";

describe("readPolicy", () => {
  const policy = { budget: 10, stopAtBudget: false, notifyExpensiveTurn: true };

  it("reads a well-formed policy", () => {
    expect(readPolicy({ ok: true, policy })).toEqual(policy);
    expect(readPolicy({ ok: true, policy: { ...policy, budget: null } })).toEqual({ ...policy, budget: null });
  });

  it("returns null for anything else", () => {
    expect(readPolicy({ ok: true })).toBeNull();
    expect(readPolicy({ ok: false, error: "x", policy })).toBeNull();
    expect(readPolicy({ ok: true, policy: { ...policy, budget: -1 } })).toBeNull();
    expect(readPolicy({ ok: true, policy: { ...policy, stopAtBudget: "yes" } })).toBeNull();
    expect(readPolicy("nope")).toBeNull();
    expect(readPolicy(null)).toBeNull();
  });
});
