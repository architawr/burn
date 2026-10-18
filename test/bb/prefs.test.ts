import { describe, expect, it } from "vitest";
import { readPrefs } from "../../extensions/bb/prefs.js";
import { SETTINGS } from "../../extensions/bb/server.js";

describe("readPrefs", () => {
  it("falls back to the defaults server.ts declares", () => {
    expect(readPrefs(undefined)).toEqual({
      chip: SETTINGS.chip.default,
      chipShows: SETTINGS.chipShows.default,
      threadBudget: null,
      flagOverBudget: SETTINGS.flagOverBudget.default,
    });
  });

  it("reads saved values and ignores a budget that is not a positive number", () => {
    expect(readPrefs({ chip: false, chipShows: "cost", threadBudget: 12.5, flagOverBudget: false })).toEqual({
      chip: false,
      chipShows: "cost",
      threadBudget: 12.5,
      flagOverBudget: false,
    });
    expect(readPrefs({ threadBudget: 0 }).threadBudget).toBeNull();
    expect(readPrefs({ chipShows: "other" }).chipShows).toBe("delta");
  });
});
