import { budgetState } from "../../src/budget.js";
import { formatBudget, formatDelta, isTokenOnly, usageLabel } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import { FLAME, FLAME_COLOR } from "./draw.js";

export interface PillTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
  getBgAnsi(color: string): string;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_MS = 120;

const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";
const BG_CODE = /^\x1b\[48;/;
const DELTA_MIN = 0.005;

function body(theme: PillTheme, report: UsageReport, budget: number | null, frame: number): string {
  if (isTokenOnly(report)) return `${theme.fg("dim", FLAME)} ${usageLabel(report)}`;
  const state = budgetState(report.cost.total, budget);
  const tone = state === "over" ? "error" : state === "near" ? "warning" : null;
  const mark = report.running
    ? theme.fg("accent", SPINNER[frame % SPINNER.length] as string)
    : theme.fg(tone ?? FLAME_COLOR, FLAME);
  const total = theme.bold(theme.fg(tone ?? "text", usageLabel(report)));
  let tail = "";
  if (state === "over" && budget !== null) tail = theme.fg("error", ` / ${formatBudget(budget)} ▲`);
  else if (state === "near" && budget !== null) tail = theme.fg("dim", ` / ${formatBudget(budget)}`);
  else if (report.cost.total > 0 && report.lastTurnCost >= DELTA_MIN) {
    const delta = formatDelta(report.lastTurnCost);
    tail = ` ${report.running ? theme.fg("accent", `${delta}…`) : theme.fg("dim", delta)}`;
  }
  return `${mark} ${total}${tail}`;
}

/**
 * The status-line pill: a flame (a spinner frame while pi works), the total and
 * the last prompt's cost, coloured by the budget in effect.
 */
export function renderPill(theme: PillTheme, report: UsageReport, budget: number | null, frame = 0): string {
  const text = ` ${body(theme, report, budget, frame)} `;
  const bg = theme.getBgAnsi("toolPendingBg");
  if (!BG_CODE.test(bg)) return text;
  const cap = bg.replace(BG_CODE, "\x1b[38;");
  return `${cap}${CAP_LEFT}\x1b[39m${bg}${text}\x1b[49m${cap}${CAP_RIGHT}\x1b[39m`;
}
