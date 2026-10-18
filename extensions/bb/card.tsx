import { type ReactNode, useState } from "react";
import { budgetFraction, budgetState } from "../../src/budget.js";
import { formatAgo, formatBudget, formatClock, formatDelta, formatDuration, formatUsd, isTokenOnly, modelName, usageLabel } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import { BudgetEditor } from "./budget-editor.js";
import { budgetWords, type EffectiveBudget } from "./budgets.js";
import { CallChart, callPoints, Meter, StackedBar } from "./charts.js";
import { Button } from "./components/ui/button.js";
import type { UsageAnswer } from "./contract.js";
import { FlameIcon } from "./icon.js";
import { cn } from "./lib/utils.js";

export function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }): ReactNode {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
      <span>{children}</span>
      {aside !== undefined ? <span className="font-medium tracking-normal normal-case">{aside}</span> : null}
    </div>
  );
}

export function WaitingNotice(): ReactNode {
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="waiting">
      <div className="font-semibold">Waiting for pi to report</div>
      <p className="text-muted-foreground">
        Burn shows a thread's cost once its pi session reports it, after the first prompt. A thread started before Burn was installed
        reports after it restarts, and only pi threads report.
      </p>
    </div>
  );
}

export function StoppedNotice({ stoppedAt, budget }: { stoppedAt: number; budget: EffectiveBudget | null }): ReactNode {
  const at = budget === null ? "its budget" : `the ${formatBudget(budget.amount)} budget`;
  return (
    <p role="note" className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive-text">
      Burn stopped a run at {at} at {formatClock(stoppedAt)}. Send another prompt to keep going.
    </p>
  );
}

const TONE_FILL = { none: "bg-success", ok: "bg-success", near: "bg-warning", over: "bg-destructive" } as const;

/** The budget bar with its share and what is left, or "No budget" with a button to set one. */
export function BudgetStatus({ cost, budget, onSet }: { cost: number; budget: EffectiveBudget | null; onSet?: () => void }): ReactNode {
  if (budget === null) {
    return (
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>No budget</span>
        {onSet !== undefined ? (
          <Button variant="ghost" className="h-6 px-2" onClick={onSet}>
            Set budget
          </Button>
        ) : null}
      </div>
    );
  }
  const words = budgetWords(cost, budget);
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground tabular-nums" data-testid="budget-status">
      <Meter fraction={budgetFraction(cost, budget.amount) ?? 0} fill={TONE_FILL[budgetState(cost, budget.amount)]} />
      <div className="flex justify-between gap-2">
        <span>{words.share}</span>
        <span>{words.left}</span>
      </div>
    </div>
  );
}

export const KIND_COLOURS = {
  input: "bg-timeline-accent",
  cacheRead: "bg-success",
  cacheWrite: "bg-attention",
  output: "bg-pr-merged",
} as const;

const KINDS = [
  ["input", "Input"],
  ["cacheWrite", "Cache write"],
  ["cacheRead", "Cache read"],
  ["output", "Output"],
] as const;

/** "Where it went": cost by token kind as one bar and a two-column legend. */
export function WhereItWent({ report }: { report: UsageReport }): ReactNode {
  const { cost } = report;
  const pct = (n: number): string => (cost.total > 0 ? `${Math.round((n / cost.total) * 100)}%` : "–");
  return (
    <div data-testid="where-it-went">
      <Label aside={report.cacheHitPct !== null ? `cache hit ${report.cacheHitPct.toFixed(0)}%` : undefined}>Where it went</Label>
      <StackedBar parts={(["input", "cacheRead", "cacheWrite", "output"] as const).map((k) => ({ key: k, value: cost[k], className: KIND_COLOURS[k] }))} />
      <div className="mt-2 grid grid-cols-2 gap-x-3.5 gap-y-1 text-xs">
        {KINDS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5 whitespace-nowrap">
            <i className={cn("size-2 shrink-0 rounded-[2px]", KIND_COLOURS[key])} />
            <span>{label}</span>
            <span className="ml-auto tabular-nums">{formatUsd(cost[key])}</span>
            <span className="w-7 text-right text-muted-foreground tabular-nums">{pct(cost[key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Models({ report }: { report: UsageReport }): ReactNode {
  if (report.byModel.length === 0) return null;
  const top = Math.max(...report.byModel.map((m) => m.cost)) || 1;
  return (
    <div data-testid="models">
      <Label>Models</Label>
      {report.byModel.map((m) => (
        <div key={m.key} className="grid grid-cols-[1fr_auto_3rem] items-center gap-2 py-0.5 text-xs">
          <span className="min-w-0 truncate" title={m.key}>
            {modelName(m.key)}
            {m.calls > 0 ? <small className="ml-1 text-muted-foreground">{m.calls} calls</small> : null}
          </span>
          <Meter fraction={m.cost / top} fill="bg-timeline-accent" className="h-1 w-16" />
          <span className="text-right tabular-nums">{formatUsd(m.cost)}</span>
        </div>
      ))}
    </div>
  );
}

const meta = (report: UsageReport): string =>
  report.calls === 0
    ? "No model calls yet"
    : `${report.calls} calls · ${report.turnCount} prompts · ${formatDuration(report.updatedAt - report.startedAt)}`;

export interface BurnCardProps {
  answer: UsageAnswer | null;
  threadId: string;
  defaultBudget: number | null;
  now: number;
  onOpenDetails: () => void;
  onCopy: () => void;
}

/** The chip's popover: what the thread cost, against its budget, where it went and on which models. */
export function BurnCard({ answer, threadId, defaultBudget, now, onOpenDetails, onCopy }: BurnCardProps): ReactNode {
  const [editing, setEditing] = useState(false);
  const report = answer?.report ?? null;
  const budget = answer?.budget ?? null;
  const editor = editing ? (
    <div className="border-t border-border px-3 py-2.5">
      <BudgetEditor threadId={threadId} budget={budget} defaultBudget={defaultBudget} autoFocus onDone={() => setEditing(false)} />
    </div>
  ) : null;
  const points = report ? callPoints(report) : [];
  return (
    <div className="flex w-[340px] max-w-full flex-col text-xs" data-testid="burn-card">
      <div className="flex items-center justify-between px-3 pt-2.5 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <FlameIcon className="text-warning" />
          Burn
        </span>
        <span>{answer?.reportedAt != null ? `updated ${formatAgo(answer.reportedAt, now)} ago` : "not reported yet"}</span>
      </div>
      {report === null ? (
        <div className="px-3 py-2.5">
          <WaitingNotice />
        </div>
      ) : (
        <>
          <div className="px-3 py-2.5">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[26px] leading-tight font-semibold tracking-tight tabular-nums">{usageLabel(report)}</span>
              {!isTokenOnly(report) && report.lastTurnCost > 0 ? (
                <span className="rounded-full bg-success/15 px-1.5 py-px text-[11.5px] font-semibold text-success tabular-nums">
                  {formatDelta(report.lastTurnCost)} last turn
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-muted-foreground tabular-nums">{meta(report)}</div>
            {isTokenOnly(report) ? null : <BudgetStatus cost={report.cost.total} budget={budget} onSet={() => setEditing(true)} />}
            {report.stoppedAt !== null ? (
              <div className="mt-2">
                <StoppedNotice stoppedAt={report.stoppedAt} budget={budget} />
              </div>
            ) : null}
          </div>
          {editor}
          {isTokenOnly(report) ? null : (
            <div className="border-t border-border px-3 py-2.5">
              <WhereItWent report={report} />
            </div>
          )}
          {points.length > 0 ? (
            <div className="border-t border-border px-3 pt-2.5 pb-2" data-testid="per-call">
              <Label aside="hover a bar">Per call</Label>
              <CallChart points={points} />
            </div>
          ) : null}
          {report.byModel.length > 0 ? (
            <div className="border-t border-border px-3 py-2.5">
              <Models report={report} />
            </div>
          ) : null}
        </>
      )}
      {report === null ? editor : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-foreground/3 px-3 py-2.5">
        <Button variant="primary" onClick={onOpenDetails}>
          Open details
        </Button>
        <Button onClick={() => setEditing((on) => !on)} aria-expanded={editing}>
          Set budget…
        </Button>
        {report !== null ? <Button onClick={onCopy}>Copy summary</Button> : null}
        <span className="ml-auto text-[11px] text-muted-foreground">Reported by pi</span>
      </div>
    </div>
  );
}
