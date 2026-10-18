import { describe, expect, it } from "vitest";
import { completions, parseCommand } from "../../extensions/pi/commands.js";
import { DEFAULT_SETTINGS } from "../../extensions/pi/settings.js";
import { applySetting, settingItems, STOP_DESCRIPTION, STOP_LABEL } from "../../extensions/pi/settings-view.js";

describe("parseCommand", () => {
  it("reads views, budgets, copy and settings", () => {
    expect(parseCommand("")).toEqual({ kind: "view", view: "overview" });
    expect(parseCommand(" Turns ")).toEqual({ kind: "view", view: "turns" });
    expect(parseCommand("history")).toEqual({ kind: "view", view: "history" });
    expect(parseCommand("budget")).toEqual({ kind: "budget", scope: "thread", input: null });
    expect(parseCommand("budget $ 7.50")).toEqual({ kind: "budget", scope: "thread", input: "$ 7.50" });
    expect(parseCommand("budget default")).toEqual({ kind: "budget", scope: "default", input: null });
    expect(parseCommand("budget default off")).toEqual({ kind: "budget", scope: "default", input: "off" });
    expect(parseCommand("copy")).toEqual({ kind: "copy" });
    expect(parseCommand("settings")).toEqual({ kind: "settings" });
    expect(parseCommand("frobnicate now")).toEqual({ kind: "unknown", name: "frobnicate" });
  });

  it("completes only what extends the typed prefix", () => {
    expect(completions("budget")?.map((c) => c.value)).toEqual(["budget ", "budget default "]);
    expect(completions("budget 10")).toBeNull();
  });
});

describe("settings list", () => {
  it("labels the stop setting and says it is off by default", () => {
    const stop = settingItems(DEFAULT_SETTINGS)[0]!;
    expect(stop).toMatchObject({ id: "stopAtBudget", label: STOP_LABEL, currentValue: "off", values: ["off", "on"] });
    expect(STOP_LABEL).toBe("Stop a run at the budget");
    expect(STOP_DESCRIPTION).toMatch(/^Off by default\. .*stops only the run whose cost crosses the budget/);
  });

  it("offers the current default budget among the choices and applies changes", () => {
    const budget = settingItems({ ...DEFAULT_SETTINGS, defaultBudget: 7.5 })[2]!;
    expect(budget.currentValue).toBe("$7.50");
    expect(budget.values).toEqual(["off", "$5", "$7.50", "$10", "$25", "$50", "$100"]);
    expect(applySetting(DEFAULT_SETTINGS, "defaultBudget", "$25").defaultBudget).toBe(25);
    expect(applySetting({ ...DEFAULT_SETTINGS, defaultBudget: 5 }, "defaultBudget", "off").defaultBudget).toBeNull();
    expect(applySetting(DEFAULT_SETTINGS, "stopAtBudget", "on").stopAtBudget).toBe(true);
    expect(applySetting(DEFAULT_SETTINGS, "notifyExpensiveTurn", "on").notifyExpensiveTurn).toBe(true);
  });
});
