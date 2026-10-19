import { describe, expect, it } from "vitest";
import { cumulative, formatCallTime, formatDelta, formatTokenCount, formatTokens, formatUsd, sparkline } from "../src/format.js";

describe("formatUsd", () => {
  it("formats the boundaries", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.31)).toBe("$0.31");
    expect(formatUsd(4.8231)).toBe("$4.82");
    expect(formatUsd(123.456)).toBe("$123.46");
  });
});

describe("formatTokenCount", () => {
  it("reads like formatTokens up to a billion, then in billions", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(13_400_000)).toBe("13M");
    expect(formatTokenCount(3_640_000_000)).toBe("3.64B");
    expect(formatTokenCount(12_300_000_000)).toBe("12.3B");
  });
});

describe("formatCallTime", () => {
  it("gives one decimal under ten seconds, then whole seconds and minutes", () => {
    expect(formatCallTime(6_758)).toBe("6.8s");
    expect(formatCallTime(27_379)).toBe("27s");
    expect(formatCallTime(65_000)).toBe("1m 05s");
  });
});

describe("formatTokens", () => {
  it("follows pi's footer rules", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_300_000)).toBe("1.3M");
    expect(formatTokens(13_400_000)).toBe("13M");
  });
});

describe("sparkline", () => {
  it("scales to the maximum and buckets to the width", () => {
    expect(sparkline([0, 4, 8], 3)).toBe("▁▄█");
    expect(sparkline([1, 8, 2, 3], 2)).toBe("█▃");
  });
  it("is empty for no values and flat for all zeros", () => {
    expect(sparkline([], 5)).toBe("");
    expect(sparkline([0, 0], 2)).toBe("▁▁");
  });
});

describe("cumulative", () => {
  it("starts from the base", () => {
    expect(cumulative([1, 2, 3], 10)).toEqual([11, 13, 16]);
  });
});

describe("usageLabel", () => {
  it("shows dollars, or tokens when the cost is zero", async () => {
    const { usageLabel } = await import("../src/format.js");
    const { sampleReport } = await import("./helpers.js");
    expect(usageLabel(sampleReport())).toBe("$4.82");
    const free = sampleReport({
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      tokens: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    expect(usageLabel(free)).toBe("1.2M tok");
    const { buildReport } = await import("../src/report.js");
    expect(usageLabel(buildReport([], undefined))).toBe("$0.00");
  });

  it("marks a list-price estimate with a tilde", async () => {
    const { formatAmount, formatCost, usageLabel } = await import("../src/format.js");
    const { sampleReport } = await import("./helpers.js");
    const guess = sampleReport({ estimated: true, cost: { input: 1, output: 0.23, cacheRead: 0, cacheWrite: 0, total: 1.23 } });
    expect(usageLabel(guess)).toBe("~$1.23");
    expect(formatCost(guess)).toBe("~$1.23");
    expect(formatCost(sampleReport())).toBe("$4.82");
    expect(formatAmount(0.001, true)).toBe("~<$0.01");
    expect(formatAmount(2, false)).toBe("$2.00");
  });
});

describe("formatDelta", () => {
  it("adds a plus sign unless it rounds to nothing", () => {
    expect(formatDelta(0.31)).toBe("+$0.31");
    expect(formatDelta(0.001)).toBe("<$0.01");
    expect(formatDelta(0)).toBe("<$0.01");
  });
});

describe("the newer helpers", () => {
  it("formats budgets, durations and ages", async () => {
    const { formatAgo, formatBudget, formatDuration } = await import("../src/format.js");
    expect(formatBudget(10)).toBe("$10");
    expect(formatBudget(7.5)).toBe("$7.50");
    expect(formatDuration(18_000)).toBe("18s");
    expect(formatDuration(62_000)).toBe("1m 02s");
    expect(formatDuration(72 * 60_000)).toBe("1h 12m");
    expect(formatDuration(51 * 3_600_000)).toBe("2d 3h");
    expect(formatAgo(0, 12_000)).toBe("12s");
    expect(formatAgo(0, 3 * 3_600_000)).toBe("3h");
  });

  it("names models without their provider", async () => {
    const { modelName, providerName } = await import("../src/format.js");
    expect(modelName("anthropic/claude-opus-4-5")).toBe("claude-opus-4-5");
    expect(providerName("anthropic/claude-opus-4-5")).toBe("anthropic");
    expect(modelName("Tools/summaries")).toBe("Tools and summaries");
    expect(providerName("Tools/summaries")).toBe("");
    expect(modelName("Other")).toBe("Other");
  });

  it("takes medians and turn multiples", async () => {
    const { median, turnMultiple } = await import("../src/format.js");
    const { sampleReport } = await import("./helpers.js");
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const { turns } = sampleReport();
    expect(turnMultiple(turns[1]!, turns)).toBeCloseTo(2.92 / 0.4);
    expect(turnMultiple(turns[1]!, turns.slice(0, 3))).toBeNull();
  });

  it("writes a Markdown summary", async () => {
    const { summaryMarkdown } = await import("../src/format.js");
    const { sampleReport } = await import("./helpers.js");
    const md = summaryMarkdown(sampleReport(), { title: "burn UX", budget: 10 });
    expect(md).toContain("### Cost of “burn UX”");
    expect(md).toContain("**$4.82** of a $10 budget (48%) · 23 calls · 4 prompts");
    expect(md).toContain("| claude-opus | 18 | $4.31 |");
    expect(md).toContain("Cache hit rate 89%.");
  });
});
