import { useId, useState, type ReactNode } from "react";
import { formatAmount, formatUsd, isTokenOnly } from "../../src/format.js";
import type { AgentUsage } from "../../src/report.js";
import type { UsageAnswer } from "./contract.js";

export function agentTotal(agents: AgentUsage | undefined): number {
  return agents?.rows.reduce((n, a) => n + a.cost.total, 0) ?? 0;
}
export function agentLabel(agents: AgentUsage | undefined): string {
  if (!agents || (agents.coverage === "partial" && agents.rows.length === 0)) return "Unavailable";
  const value = formatAmount(agentTotal(agents), agents.rows.some(a => a.estimated));
  return agents.coverage === "partial" ? `≥ ${value}` : value;
}

/** Nested rows are a subset of the owning thread's row, not new rows to sum. */
export function AgentRows({ agents }: { agents?: AgentUsage }): ReactNode {
  if (!agents || agents.rows.length === 0) return null;
  return <details className="border-t border-border px-3 py-2 pl-8 text-[11.5px] text-muted-foreground" data-testid="agent-rows">
    <summary className="cursor-pointer">↳ Subagents · {agents.rows.length}<span className="float-right tabular-nums">{agentLabel(agents)} · of the thread total</span></summary>
    {agents.rows.map((a, i) => <div key={a.id} className="mt-1.5 flex items-baseline justify-between gap-2 pl-3">
      <span className="min-w-0 truncate" title={a.id}>Subagent {i + 1}</span>
      <span className="shrink-0 tabular-nums">{a.calls} calls · {formatAmount(a.cost.total, a.estimated)}</span>
    </div>)}
  </details>;
}

/** Both scopes are explicit: the headline is this thread, the family total is separate. */
export function CostBreakdown({ answer, children }: { answer: UsageAnswer; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { report, family } = answer;
  if (!report || isTokenOnly(report)) return children;
  const ownAgents = agentTotal(report.agents);
  const allAgents = agentTotal(family.agents);
  const known = report.agents !== undefined && family.agents?.coverage === "available";
  const row = (label: string, value: string) => <div className="flex justify-between gap-3 py-0.5"><span>{label}</span><b className="shrink-0 font-medium tabular-nums">{value}</b></div>;
  return <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="cursor-help text-left underline decoration-dotted decoration-muted-foreground decoration-1 underline-offset-[5px] hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm" aria-label="Cost calculation" aria-expanded={open} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={e => {if(e.key === "Escape") {e.stopPropagation();setOpen(false);}}}>{children}</button>
    {open ? <span role="tooltip" id={id} className="absolute top-full left-0 z-50 mt-1 block w-[284px] max-w-[calc(100vw-48px)] rounded-lg border border-border bg-popover p-3 text-xs font-normal tracking-normal text-popover-foreground shadow-lg" data-testid="cost-breakdown">
      <b className="mb-1 block font-semibold">This thread</b>
      {report.agents?.coverage === "available" ? <>{row("Main agent", formatUsd(Math.max(0, report.cost.total - ownAgents)))}{row("Its subagents", agentLabel(report.agents))}</> : row("Subagents (known portion)", agentLabel(report.agents))}
      {row("Displayed amount", formatAmount(report.cost.total, report.estimated))}
      {family.children.length > 0 ? <>
      <b className="mt-3 mb-1 block border-t border-border pt-2 font-semibold">With children</b>
      {known ? <>{row("Main agent", formatUsd(Math.max(0, report.cost.total - ownAgents)))}{row("Child threads, own calls", formatUsd(Math.max(0, family.total - report.cost.total - (allAgents - ownAgents))))}{row("All subagents", agentLabel(family.agents))}<span className="block text-[11px] text-muted-foreground">This thread {formatUsd(ownAgents)} · children {formatUsd(Math.max(0, allAgents - ownAgents))}</span></> : <>{row("This thread", formatAmount(report.cost.total, report.estimated))}{row("Child threads", formatUsd(Math.max(0, family.total - report.cost.total)))}<span className="block text-[11px] text-muted-foreground">Agent breakdown is incomplete; known agents are already in these totals.</span></>}
      <span className="mt-1 block border-t border-border pt-1">{row("Total with children", formatAmount(family.total, family.estimated))}</span>
      </> : null}
    </span> : null}
  </span>;
}
