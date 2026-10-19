import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityGrid, callTimeQuantile } from "../../extensions/bb/spend/tally.js";
import { CALL_TIME_BUCKETS, HOUR_MS, type HourRow } from "../../src/report.js";

const buckets = (at: Record<number, number>): number[] => Array.from({ length: CALL_TIME_BUCKETS }, (_, i) => at[i] ?? 0);

describe("callTimeQuantile", () => {
  it("is null with no timed calls", () => {
    expect(callTimeQuantile(buckets({}), 0.5)).toBeNull();
  });

  it("reads inside a bucket geometrically", () => {
    const all = buckets({ 3: 100 });
    expect(callTimeQuantile(all, 0.5)).toBeCloseTo(4000 * Math.SQRT2, 6);
    const p90 = callTimeQuantile(all, 0.9) as number;
    expect(p90).toBeGreaterThan(4000 * Math.SQRT2);
    expect(p90).toBeLessThan(8000);
  });

  it("reads inside the first bucket linearly", () => {
    expect(callTimeQuantile(buckets({ 0: 10 }), 0.5)).toBeCloseTo(500, 6);
  });

  it("picks the bucket that holds the q-th call", () => {
    const split = buckets({ 1: 10, 4: 10, 6: 80 });
    expect(callTimeQuantile(split, 0.15)).toBeGreaterThanOrEqual(8000);
    expect(callTimeQuantile(split, 0.15)).toBeLessThan(16000);
    expect(callTimeQuantile(split, 0.5)).toBeGreaterThanOrEqual(32000);
    expect(callTimeQuantile(split, 0.5)).toBeLessThan(64000);
    expect(callTimeQuantile(split, 0.05)).toBeLessThan(2000);
  });

  it("keeps the open last bucket below 256 s", () => {
    const slow = buckets({ 8: 5 });
    expect(callTimeQuantile(slow, 0.5)).toBeGreaterThanOrEqual(128_000);
    expect(callTimeQuantile(slow, 0.99)).toBeLessThan(256_000);
  });
});

describe("activityGrid", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "America/Toronto");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const row = (ms: number, calls: number, tokens = 0, cost = 0): HourRow => ({ hour: Math.floor(ms / HOUR_MS), calls, tokens, cost });

  it("places an hour on its local day and hour", () => {
    const grid = activityGrid([row(new Date(2026, 9, 18, 11).getTime(), 3)], ["2026-10-17", "2026-10-18"], "local", "calls");
    expect(grid.map((r) => r.day)).toEqual(["2026-10-17", "2026-10-18"]);
    expect(grid[0]?.hours).toEqual(new Array(24).fill(0));
    expect(grid[1]?.hours[11]).toBe(3);
    expect(grid[1]?.hours.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("sums the two UTC hours that share one local hour when the clocks go back", () => {
    // Nov 1, 2026: 01:00 EDT is 05:00Z, and 01:00 EST an hour later is 06:00Z.
    const hours = [row(Date.UTC(2026, 10, 1, 5), 2), row(Date.UTC(2026, 10, 1, 6), 5)];
    const grid = activityGrid(hours, ["2026-11-01"], "local", "calls");
    expect(grid[0]?.hours[1]).toBe(7);
  });

  it("places an hour on its UTC day and hour in the UTC zone", () => {
    const late = row(Date.UTC(2026, 9, 18, 23), 4);
    expect(activityGrid([late], ["2026-10-18"], "utc", "calls")[0]?.hours[23]).toBe(4);
    expect(activityGrid([late], ["2026-10-18"], "local", "calls")[0]?.hours[19]).toBe(4);
  });

  it("sums rows from many threads in the metric asked for, and drops hours outside the days", () => {
    const at = new Date(2026, 9, 18, 9).getTime();
    const hours = [row(at, 1, 100, 0.5), row(at, 2, 300, 0.25), row(new Date(2026, 9, 10, 9).getTime(), 9, 9, 9)];
    const days = ["2026-10-18"];
    expect(activityGrid(hours, days, "local", "calls")[0]?.hours[9]).toBe(3);
    expect(activityGrid(hours, days, "local", "tokens")[0]?.hours[9]).toBe(400);
    expect(activityGrid(hours, days, "local", "cost")[0]?.hours[9]).toBe(0.75);
    expect(activityGrid(hours, days, "local", "calls")).toHaveLength(1);
  });
});
