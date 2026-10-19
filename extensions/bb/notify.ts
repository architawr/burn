import { budgetAlert, isExpensiveTurn } from "../../src/budget.js";
import { formatAmount, formatBudget, turnMultiple } from "../../src/format.js";
import type { TurnRow, UsageReport } from "../../src/report.js";
import type { BurnAlert } from "./alerts.js";

/** Something a new report changed that deserves a toast, before it has words. `estimated`: its amounts are list-price estimates. */
export type AlertEvent =
  | { kind: "near" | "over"; cost: number; budget: number; estimated: boolean }
  | { kind: "stopped"; stoppedAt: number; budget: number | null }
  | { kind: "expensive"; turn: TurnRow; multiple: number; estimated: boolean };

export interface AlertOptions {
  /** The thread's effective budget in dollars, or null. */
  budget: number | null;
  budgetAlerts: boolean;
  notifyExpensiveTurn: boolean;
}

/** Turns that finished between two reports: the last one when pi went idle, the previous one when a new prompt began. */
function finishedTurns(prev: UsageReport, next: UsageReport): TurnRow[] {
  const numbers = new Set<number>();
  if (next.turnCount > prev.turnCount) numbers.add(prev.turnCount);
  if (prev.running && !next.running) numbers.add(next.turnCount);
  return next.turns.filter((t) => t.n > 0 && numbers.has(t.n));
}

/**
 * What changed from `prev` to `next`. A thread's first report only sets the
 * baseline, so reopening an old thread that is already over budget stays quiet.
 */
export function alertEvents(prev: UsageReport | null, next: UsageReport, opts: AlertOptions): AlertEvent[] {
  if (prev === null) return [];
  const events: AlertEvent[] = [];
  if (opts.budgetAlerts && opts.budget !== null) {
    const crossed = budgetAlert(prev.cost.total, next.cost.total, opts.budget);
    if (crossed !== null) events.push({ kind: crossed, cost: next.cost.total, budget: opts.budget, estimated: next.estimated });
  }
  if (next.stoppedAt !== null && next.stoppedAt !== prev.stoppedAt) {
    events.push({ kind: "stopped", stoppedAt: next.stoppedAt, budget: opts.budget });
  }
  if (opts.notifyExpensiveTurn) {
    for (const turn of finishedTurns(prev, next)) {
      const multiple = turnMultiple(turn, next.turns);
      if (multiple !== null && isExpensiveTurn(turn, next.turns)) events.push({ kind: "expensive", turn, multiple, estimated: next.estimated });
    }
  }
  return events;
}

/** The toast for an event. `id` is the same for the same event, so every window can drop a repeat. */
export function alertFor(event: AlertEvent, threadId: string, threadTitle: string, at: number): BurnAlert {
  const name = `“${threadTitle}”`;
  switch (event.kind) {
    case "near": {
      const share = Math.round((event.cost / event.budget) * 100);
      return {
        id: `near:${threadId}:${event.budget}`,
        kind: "near",
        threadId,
        title: `${name} is near its budget`,
        body: `${formatAmount(event.cost, event.estimated)} of the ${formatBudget(event.budget)} thread budget (${share}%).`,
        at,
      };
    }
    case "over":
      return {
        id: `over:${threadId}:${event.budget}`,
        kind: "over",
        threadId,
        title: `${name} is over its budget`,
        body: `${formatAmount(event.cost, event.estimated)} spent, over the ${formatBudget(event.budget)} thread budget.`,
        at,
      };
    case "stopped":
      return {
        id: `stopped:${threadId}:${event.stoppedAt}`,
        kind: "stopped",
        threadId,
        title: `Burn stopped ${name} at its ${event.budget === null ? "" : `${formatBudget(event.budget)} `}budget`,
        body: "Send another prompt to keep going, or raise the thread's budget.",
        at,
      };
    case "expensive":
      return {
        id: `expensive:${threadId}:${event.turn.n}`,
        kind: "expensive",
        threadId,
        title: `An expensive turn in ${name}`,
        body: `Turn ${event.turn.n} cost ${formatAmount(event.turn.cost, event.estimated)}, ${event.multiple.toFixed(1)} times the thread's median turn.`,
        at,
      };
  }
}
