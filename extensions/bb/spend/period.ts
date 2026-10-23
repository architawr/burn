import type { SpendOutput, SpendRange } from "./contract.js";
import { dayDate, RANGE_DAYS } from "./days.js";

/** The earliest day the page goes back to; JavaScript reads years below 100 as 19xx. */
export const FIRST_DAY = "2000-01-01";

/** What the Burn page shows; `end` null is the range that ends today. */
export interface Period {
  range: SpendRange;
  end: string | null;
}

// "today" is how Burn 0.5 linked the one-day range.
const RANGE_PATHS: Record<string, SpendRange> = { day: "today", today: "today", "7d": "7d", "30d": "30d" };
const PATHS: Record<SpendRange, string> = { today: "day", "7d": "7d", "30d": "30d" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The YYYY-MM-DD day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A real calendar day from FIRST_DAY on. */
export const isDay = (day: string): boolean => DAY.test(day) && day >= FIRST_DAY && addDays(day, 0) === day;

/** `range` ending on `day`, or the newest one once `day` is today or later. */
export const periodEnding = (range: SpendRange, day: string, today: string): Period => ({ range, end: day >= today ? null : day });

export const stepPeriod = (period: Period, by: -1 | 1, today: string): Period =>
  periodEnding(period.range, addDays(period.end ?? today, by * RANGE_DAYS[period.range]), today);

/** The period in the page address after the panel root, such as "7d/2026-10-15"; null when it names none. */
export function parsePeriod(subPath: string): Period | null {
  const [head = "", day] = subPath.split("/");
  if (!Object.hasOwn(RANGE_PATHS, head)) return null;
  return { range: RANGE_PATHS[head] as SpendRange, end: day !== undefined && isDay(day) ? day : null };
}

/** The newest period has no day in its address, so a page left open keeps following today. */
export const periodPath = ({ range, end }: Period): string => (end === null ? PATHS[range] : `${PATHS[range]}/${end}`);

const format = (day: string, opts: Intl.DateTimeFormatOptions): string => dayDate(day).toLocaleDateString("en-US", opts);

/** "Today, Oct 22", "Thu, Sep 10", "Oct 16 – 22" or "Sep 23 – Oct 22"; years appear only outside today's. */
export function periodLabel(range: SpendRange, last: string, today: string): string {
  const year = today.slice(0, 4);
  const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (range === "today") {
    if (last === today) return `Today, ${format(last, short)}`;
    if (last === addDays(today, -1)) return `Yesterday, ${format(last, short)}`;
    return format(last, { weekday: "short", ...short, ...(last.startsWith(year) ? {} : { year: "numeric" }) });
  }
  const first = addDays(last, 1 - RANGE_DAYS[range]);
  if (!first.startsWith(year) || !last.startsWith(year)) {
    return `${format(first, { ...short, year: "numeric" })} – ${format(last, { ...short, year: "numeric" })}`;
  }
  if (first.slice(0, 7) === last.slice(0, 7)) return `${format(first, short)} – ${format(last, { day: "numeric" })}`;
  return `${format(first, short)} – ${format(last, short)}`;
}

/** Whether an answer covers the newest days: its last day is its today. */
export const isLatest = (data: Pick<SpendOutput, "days" | "today">): boolean => data.days.at(-1)?.day === data.today;
