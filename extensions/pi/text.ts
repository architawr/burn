import { budgetFraction, budgetState, NEAR_FRACTION } from "../../src/budget.js";
import {
  formatBudget,
  formatClock,
  formatDelta,
  formatDuration,
  formatTokens,
  formatUsd,
  isTokenOnly,
  modelName,
  providerName,
  usageLabel,
} from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import { clip, plural } from "./draw.js";

const LAST_TURNS = 5;
const PROMPT_WIDTH = 48;

function budgetLine(report: UsageReport, budget: number | null, stopAtBudget: boolean): string {
  if (budget === null) return "No budget (/burn budget 10 sets one).";
  const fraction = budgetFraction(report.cost.total, budget) ?? 0;
  const state = budgetState(report.cost.total, budget);
  const status = state === "over" ? "over budget" : state === "near" ? "near the budget" : "used";
  const does = stopAtBudget
    ? "stops the run that crosses it"
    : "never stops a run (stop at budget is off by default; /burn settings)";
  return `Budget ${formatBudget(budget)}: ${Math.round(fraction * 100)}% ${status}. Burn warns at ${Math.round(NEAR_FRACTION * 100)}% and 100% and ${does}.`;
}

/** `/burn` outside the TUI: the same figures as plain text, with the budget and the last few turns. */
export function summaryText(report: UsageReport, policy: { budget: number | null; stopAtBudget: boolean }): string {
  if (report.calls === 0 && report.cost.total === 0) {
    return ["Thread usage", "No model calls yet.", budgetLine(report, policy.budget, policy.stopAtBudget)].join("\n");
  }
  const tokenOnly = isTokenOnly(report);
  const lines = [
    `Thread usage · ${plural(report.calls, "call")} · ${plural(report.turnCount, "prompt")} · ${formatDuration(report.updatedAt - report.startedAt)}`,
    tokenOnly
      ? `${usageLabel(report)} used (this provider reports no cost)`
      : `${usageLabel(report)} spent · last turn ${formatDelta(report.lastTurnCost)} · ${formatUsd(report.cost.total / Math.max(1, report.calls))} per call`,
    budgetLine(report, policy.budget, policy.stopAtBudget),
  ];
  if (report.stoppedAt !== null) {
    const amount = policy.budget === null ? "the budget" : `the ${formatBudget(policy.budget)} budget`;
    lines.push(`Stopped at ${amount} at ${formatClock(report.stoppedAt)}. Send another prompt to keep going.`);
  }
  const { tokens, cost } = report;
  const kind = (label: string, t: number, c: number) => `${label} ${formatTokens(t)}${tokenOnly ? "" : ` ${formatUsd(c)}`}`;
  const reasoning = tokens.reasoning > 0 ? ` (output includes ${formatTokens(tokens.reasoning)} reasoning)` : "";
  lines.push(
    `By token type: ${[
      kind("input", tokens.input, cost.input),
      kind("cache read", tokens.cacheRead, cost.cacheRead),
      kind("cache write", tokens.cacheWrite, cost.cacheWrite),
      kind("output", tokens.output, cost.output),
    ].join(" · ")}${reasoning}`,
  );
  if (report.byModel.length > 0) {
    const model = (m: UsageReport["byModel"][number]) => {
      const provider = providerName(m.key);
      const amount = tokenOnly ? `${formatTokens(m.tokens)} tok` : formatUsd(m.cost);
      return `${modelName(m.key)}${provider ? ` (${provider})` : ""} ${plural(m.calls, "call")} ${amount}`;
    };
    lines.push(`By model: ${report.byModel.map(model).join(" · ")}`);
  }
  const extra: string[] = [];
  if (report.cacheHitPct !== null) extra.push(`cache hit ${report.cacheHitPct.toFixed(1)}%`);
  const ctx = report.context;
  if (ctx) {
    extra.push(
      ctx.percent === null || ctx.tokens === null
        ? `context unknown until the next reply (window ${formatTokens(ctx.window)})`
        : `context ${formatTokens(ctx.tokens)} / ${formatTokens(ctx.window)} (${ctx.percent.toFixed(1)}%)`,
    );
  }
  if (extra.length > 0) lines.push(extra.join(" · "));
  const turns = report.turns.slice(-LAST_TURNS).reverse();
  if (turns.length > 0) {
    lines.push("Last turns:");
    for (const t of turns) {
      const prompt = clip(t.prompt || "(no text)", PROMPT_WIDTH);
      const amount = tokenOnly ? `${formatTokens(t.tokens.input + t.tokens.output + t.tokens.cacheRead + t.tokens.cacheWrite)} tok` : formatUsd(t.cost);
      lines.push(`  #${t.n} ${formatClock(t.at)}  ${prompt}  ${plural(t.calls, "call")}  ${amount}`);
    }
  }
  return lines.join("\n");
}
