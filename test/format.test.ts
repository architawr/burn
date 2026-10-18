import { describe, expect, it } from "vitest";
import { cumulative, formatDelta, formatTokens, formatUsd, sparkline } from "../src/format.js";

describe("formatUsd", () => {
  it("formats the boundaries", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.31)).toBe("$0.31");
    expect(formatUsd(4.8231)).toBe("$4.82");
    expect(formatUsd(123.456)).toBe("$123.46");
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
});

describe("formatDelta", () => {
  it("adds a plus sign unless it rounds to nothing", () => {
    expect(formatDelta(0.31)).toBe("+$0.31");
    expect(formatDelta(0.001)).toBe("<$0.01");
    expect(formatDelta(0)).toBe("<$0.01");
  });
});
