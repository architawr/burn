// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEND_METRICS, SPEND_RANGES, SPEND_ZONES } from "../../extensions/bb/spend/contract.js";
import { DEFAULT_VIEW, loadView, saveView, VIEW_CHOICES, VIEW_KEY } from "../../extensions/bb/spend/view.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the Burn page's remembered choices", () => {
  it("start from the defaults, and come back as saved", () => {
    expect(loadView()).toEqual(DEFAULT_VIEW);
    const view = { range: "30d", metric: "tokens", projectId: "proj_c", tz: "utc", prices: "list" } as const;
    saveView(view);
    expect(loadView()).toEqual(view);
  });

  it("keep each field they know, and take the default for the rest", () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ range: "90d", metric: "tokens", projectId: 7 }));
    expect(loadView()).toEqual({ ...DEFAULT_VIEW, metric: "tokens" });
    localStorage.setItem(VIEW_KEY, JSON.stringify({ projectId: "x".repeat(101) }));
    expect(loadView().projectId).toBeNull();
    localStorage.setItem(VIEW_KEY, "{");
    expect(loadView()).toEqual(DEFAULT_VIEW);
    localStorage.setItem(VIEW_KEY, "null");
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });

  it("carry over Burn 0.5's UTC choice until they are first saved", () => {
    localStorage.setItem("burn.spend.tz", "utc");
    expect(loadView().tz).toBe("utc");
    saveView({ ...DEFAULT_VIEW, tz: "local" });
    expect(loadView().tz).toBe("local");
  });

  it("fall back to the defaults when storage is blocked, and only warn when saving fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadView()).toEqual(DEFAULT_VIEW);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => saveView(DEFAULT_VIEW)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("remembering the Burn page's choices failed: blocked"));
  });

  it("allow the ranges, measures and days the spend request takes", () => {
    expect(VIEW_CHOICES.range).toEqual(SPEND_RANGES);
    expect(VIEW_CHOICES.metric).toEqual(SPEND_METRICS);
    expect(VIEW_CHOICES.tz).toEqual(SPEND_ZONES);
  });
});
