import { describe, expect, it } from "vitest";
import { addDays, isLatest, parsePeriod, periodEnding, periodLabel, periodPath, stepPeriod } from "../../extensions/bb/spend/period.js";

describe("parsePeriod and periodPath", () => {
  it("read the range and an optional last day from the page address", () => {
    expect(parsePeriod("")).toBeNull();
    expect(parsePeriod("week")).toBeNull();
    expect(parsePeriod("7d")).toEqual({ range: "7d", end: null });
    expect(parsePeriod("30d")).toEqual({ range: "30d", end: null });
    expect(parsePeriod("day/2026-09-10")).toEqual({ range: "today", end: "2026-09-10" });
    // Burn 0.5 linked the one-day range as "today".
    expect(parsePeriod("today")).toEqual({ range: "today", end: null });
    expect(parsePeriod("today/2026-09-10")).toEqual({ range: "today", end: "2026-09-10" });
  });

  it("drop a last day that is not a real calendar day from 2000 on", () => {
    expect(parsePeriod("30d/1999-12-31")).toEqual({ range: "30d", end: null });
    expect(parsePeriod("30d/nope")).toEqual({ range: "30d", end: null });
    expect(parsePeriod("7d/2026-02-30")).toEqual({ range: "7d", end: null });
    expect(parsePeriod("7d/0002-01-01")).toEqual({ range: "7d", end: null });
  });

  it("write back what they read", () => {
    for (const path of ["day", "7d/2026-10-08", "30d", "day/2026-09-10"]) expect(periodPath(parsePeriod(path) as never)).toBe(path);
  });
});

describe("addDays", () => {
  it("crosses months, years and the daylight-saving dates", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-10-18", -30)).toBe("2026-09-18");
  });
});

describe("periodEnding and stepPeriod", () => {
  const today = "2026-10-18";

  it("end on the day given, or on no day once that is today or later", () => {
    expect(periodEnding("7d", "2026-09-14", today)).toEqual({ range: "7d", end: "2026-09-14" });
    expect(periodEnding("7d", today, today)).toEqual({ range: "7d", end: null });
    expect(periodEnding("today", "2026-10-25", today)).toEqual({ range: "today", end: null });
  });

  it("move by one range", () => {
    expect(stepPeriod({ range: "7d", end: null }, -1, today)).toEqual({ range: "7d", end: "2026-10-11" });
    expect(stepPeriod({ range: "7d", end: "2026-10-15" }, 1, today)).toEqual({ range: "7d", end: null });
    expect(stepPeriod({ range: "30d", end: null }, -1, today)).toEqual({ range: "30d", end: "2026-09-18" });
    expect(stepPeriod({ range: "today", end: "2026-10-10" }, 1, today)).toEqual({ range: "today", end: "2026-10-11" });
  });
});

describe("periodLabel", () => {
  const today = "2026-10-22";

  it("names a day", () => {
    expect(periodLabel("today", today, today)).toBe("Today, Oct 22");
    expect(periodLabel("today", "2026-10-21", today)).toBe("Yesterday, Oct 21");
    expect(periodLabel("today", "2026-09-10", today)).toBe("Thu, Sep 10");
    expect(periodLabel("today", "2025-10-10", today)).toBe("Fri, Oct 10, 2025");
  });

  it("names the first and last of several days, with years only outside this one", () => {
    expect(periodLabel("7d", today, today)).toBe("Oct 16 – 22");
    expect(periodLabel("30d", today, today)).toBe("Sep 23 – Oct 22");
    expect(periodLabel("7d", "2026-01-01", today)).toBe("Dec 26, 2025 – Jan 1, 2026");
  });
});

describe("isLatest", () => {
  it("is whether an answer's last day is its today", () => {
    const days = (last: string) => [{ day: "2026-10-17" }, { day: last }] as never;
    expect(isLatest({ days: days("2026-10-18"), today: "2026-10-18" })).toBe(true);
    expect(isLatest({ days: days("2026-10-11"), today: "2026-10-18" })).toBe(false);
  });
});
