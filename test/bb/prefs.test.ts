import { describe, expect, it } from "vitest";
import { discountsOf, readPrefs } from "../../extensions/bb/prefs.js";
import { SETTINGS } from "../../extensions/bb/server.js";

describe("readPrefs", () => {
  it("falls back to the defaults server.ts declares", () => {
    expect(readPrefs(undefined)).toEqual({
      chip: SETTINGS.chip.default,
      chipShows: SETTINGS.chipShows.default,
      threadBudget: null,
      flagOverBudget: SETTINGS.flagOverBudget.default,
      discounted: false,
    });
  });

  it("reads saved values and ignores a budget that is not a positive number", () => {
    expect(readPrefs({ chip: false, chipShows: "cost", threadBudget: 12.5, flagOverBudget: false })).toEqual({
      chip: false,
      chipShows: "cost",
      threadBudget: 12.5,
      flagOverBudget: false,
      discounted: false,
    });
    expect(readPrefs({ threadBudget: 0 }).threadBudget).toBeNull();
    expect(readPrefs({ chipShows: "other" }).chipShows).toBe("delta");
  });

  it("says whether some discount is set", () => {
    expect(readPrefs({ outputDiscount: 16 }).discounted).toBe(true);
    expect(readPrefs({ discount: 0 }).discounted).toBe(false);
  });
});

describe("discountsOf", () => {
  it("lets each line item's override replace the discount", () => {
    expect(discountsOf({ discount: 16, cacheReadDiscount: 14 })).toEqual({ input: 16, output: 16, cacheRead: 14, cacheWrite: 16 });
    expect(discountsOf({ discount: 16, inputDiscount: 0 }).input).toBe(0);
  });

  it("ignores a value that is not a number", () => {
    expect(discountsOf({ discount: "16", outputDiscount: null })).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(discountsOf(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});
