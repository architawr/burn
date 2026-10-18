import { dayKey } from "../../../src/report.js";
import type { SpendRange } from "./contract.js";

export const RANGE_DAYS: Record<SpendRange, number> = { today: 1, "7d": 7, "30d": 30 };

/** `count` local calendar days, oldest first, the last one `offset` days before the day of `now`. */
export function localDays(now: number, count: number, offset = 0): string[] {
  const d = new Date(now);
  // Noon, so a daylight-saving shift can never move the date.
  return Array.from({ length: count }, (_, i) =>
    dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset - (count - 1 - i), 12).getTime()),
  );
}

/** Noon on a YYYY-MM-DD local day. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}
