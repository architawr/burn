import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readSettings, settingsPath, writeSettings } from "../../extensions/pi/settings.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "burn-settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("burn.json", () => {
  it("lives in the agent directory", () => {
    expect(settingsPath(dir)).toBe(join(dir, "burn.json"));
  });

  it("reads a missing file as the quiet defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({ defaultBudget: null, stopAtBudget: false, notifyExpensiveTurn: false });
    expect(readSettings(settingsPath(dir))).toEqual({ settings: DEFAULT_SETTINGS, error: null });
  });

  it("reads every setting and fills in missing ones", () => {
    const path = settingsPath(dir);
    writeFileSync(path, JSON.stringify({ defaultBudget: 7.5, stopAtBudget: true, notifyExpensiveTurn: true }));
    expect(readSettings(path).settings).toEqual({ defaultBudget: 7.5, stopAtBudget: true, notifyExpensiveTurn: true });
    writeFileSync(path, JSON.stringify({ stopAtBudget: true }));
    expect(readSettings(path)).toEqual({ settings: { ...DEFAULT_SETTINGS, stopAtBudget: true }, error: null });
  });

  it("treats a malformed file as missing and says why", () => {
    const path = settingsPath(dir);
    for (const text of ["{nope", "[]", JSON.stringify({ stopAtBudget: "yes" }), JSON.stringify({ defaultBudget: -1 })]) {
      writeFileSync(path, text);
      const { settings, error } = readSettings(path);
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(error).toContain(path);
    }
  });

  it("writes atomically and reads back what it wrote", () => {
    const path = settingsPath(join(dir, "nested"));
    writeSettings(path, { defaultBudget: 10, stopAtBudget: false, notifyExpensiveTurn: true });
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ defaultBudget: 10, stopAtBudget: false, notifyExpensiveTurn: true });
    expect(readSettings(path).settings.defaultBudget).toBe(10);
    expect(readdirSync(join(dir, "nested"))).toEqual(["burn.json"]);
  });
});
