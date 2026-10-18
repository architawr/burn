import { formatUsd, usageLabel } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";

export interface PillTheme {
  fg(color: string, text: string): string;
  getBgAnsi(color: string): string;
}

const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";
const BG_CODE = /^\x1b\[48;/;
const DELTA_MIN = 0.005;
const WARN_PERCENT = 70;
const ERROR_PERCENT = 90;

function textColor(report: UsageReport): string {
  const percent = report.context?.percent;
  if (percent != null && percent > ERROR_PERCENT) return "error";
  if (percent != null && percent > WARN_PERCENT) return "warning";
  return "text";
}

/** The status-line pill; a session with no model call yet reads $0.00. */
export function renderPill(theme: PillTheme, report: UsageReport): string {
  const delta =
    report.cost.total > 0 && report.lastTurnCost >= DELTA_MIN
      ? ` ${theme.fg("dim", `+${formatUsd(report.lastTurnCost).slice(1)}`)}`
      : "";
  const body = ` ${theme.fg(textColor(report), usageLabel(report))}${delta} `;
  const bg = theme.getBgAnsi("toolPendingBg");
  if (!BG_CODE.test(bg)) return body;
  const cap = bg.replace(BG_CODE, "\x1b[38;");
  return `${cap}${CAP_LEFT}\x1b[39m${bg}${body}\x1b[49m${cap}${CAP_RIGHT}\x1b[39m`;
}
