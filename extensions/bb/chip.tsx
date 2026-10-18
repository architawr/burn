import {
  type PluginThreadHeaderActionProps,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cumulative, formatDelta, formatTokens, formatUsd, usageLabel } from "../../src/format.js";
import { buildReport, type UsageReport } from "../../src/report.js";
import { AreaChart, BarChart } from "./charts.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { useFooterMount } from "./footer.js";
import { cn } from "./lib/utils.js";
import type { rpcContract } from "./server.js";

const EMPTY_REPORT = buildReport([], undefined);

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const isSignalFor = (payload: unknown, threadId: string): boolean =>
  payload === null || (typeof payload === "object" && (payload as { threadId?: unknown }).threadId === threadId);

/** The thread's latest report, refetched on its own signal and after a reconnect (signals are not replayed). */
export function useUsage(threadId: string): { report: UsageReport | null; reportedAt: number | null; error: string | null } {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<{ report: UsageReport | null; reportedAt: number | null }>({ report: null, reportedAt: null });
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const lastConnection = useRef(connection);

  const refetch = useCallback(() => {
    const asked = ++latest.current;
    rpc.call("usage", { threadId }).then(
      (next) => {
        if (asked !== latest.current) return;
        setState(next);
        setError(null);
      },
      (cause: unknown) => {
        if (asked === latest.current) setError(errorText(cause));
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(
    "usage",
    useCallback(
      (payload: unknown) => {
        if (isSignalFor(payload, threadId)) refetch();
      },
      [threadId, refetch],
    ),
  );
  useEffect(() => {
    if (connection === "connected" && lastConnection.current !== "connected") refetch();
    lastConnection.current = connection;
  }, [connection, refetch]);

  return { ...state, error };
}

const ago = (ms: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
};

const since = (ms: number): string =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Heading({ children }: { children: ReactNode }) {
  return <div className="mt-2 text-[10px] font-semibold tracking-wide uppercase opacity-60">{children}</div>;
}

function Row({ label, tokens, cost }: { label: string; tokens?: string; cost: string }) {
  return (
    <div className="flex items-baseline gap-2 tabular-nums">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tokens ? <span className="opacity-70">{tokens}</span> : null}
      <span className="w-14 text-right">{cost}</span>
    </div>
  );
}

/** The hover card; its sections follow the /burn panel in pi. */
export function UsageCard({ report, reportedAt }: { report: UsageReport; reportedAt: number | null }): ReactNode {
  const { cost, tokens, context } = report;
  const costs = report.series.map((p) => p.cost);
  const base = cost.total - costs.reduce((a, b) => a + b, 0);
  const kinds: [string, number, number][] = [
    ["Input (uncached)", tokens.input, cost.input],
    ["Cache read", tokens.cacheRead, cost.cacheRead],
    ["Cache write", tokens.cacheWrite, cost.cacheWrite],
    ["Output", tokens.output, cost.output],
  ];
  return (
    <div className="flex w-72 flex-col gap-0.5 py-0.5 text-xs" data-testid="usage-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold tabular-nums">{usageLabel(report)}</span>
        <span className="opacity-70">last turn {formatDelta(report.lastTurnCost)}</span>
      </div>
      <div className="opacity-70">
        {report.calls === 0 ? "No model calls yet" : `${report.calls} calls · since ${since(report.startedAt)}`}
      </div>
      {context ? (
        <>
          <Heading>Context window</Heading>
          {context.percent != null && context.tokens != null ? (
            <>
              <div className="tabular-nums">
                {formatTokens(context.tokens)} / {formatTokens(context.window)} ({context.percent.toFixed(1)}%)
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-current/20">
                <div className="h-full bg-current" style={{ width: `${Math.min(100, context.percent)}%` }} />
              </div>
            </>
          ) : (
            <div className="opacity-70">unknown until the next reply</div>
          )}
        </>
      ) : null}
      <Heading>Cost by token type</Heading>
      {kinds.map(([label, count, spent]) => (
        <Row key={label} label={label} tokens={formatTokens(count)} cost={formatUsd(spent)} />
      ))}
      {report.byModel.length > 0 ? (
        <>
          <Heading>By model</Heading>
          {report.byModel.map((m) => (
            <Row key={m.key} label={m.calls > 0 ? `${m.key} · ${m.calls} calls` : m.key} cost={formatUsd(m.cost)} />
          ))}
        </>
      ) : null}
      {costs.length > 0 ? (
        <>
          <Heading>Cumulative cost · cost per call</Heading>
          <div className="flex gap-2">
            <AreaChart values={cumulative(costs, base)} className="h-10 flex-1 rounded bg-current/10" />
            <BarChart values={costs} highlight={costs.length - 1} className="h-10 flex-1 rounded bg-current/10" />
          </div>
        </>
      ) : null}
      <div className="mt-2 opacity-60">
        {report.cacheHitPct != null ? `cache hit (session) ${report.cacheHitPct.toFixed(0)}% · ` : ""}
        {reportedAt != null ? `Reported by pi · updated ${ago(reportedAt)} ago` : "Waiting for pi to report"}
      </div>
    </div>
  );
}

function BurnPill({ report, reportedAt, placement }: { report: UsageReport; reportedAt: number | null; placement: "footer" | "header" }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-placement={placement}
            aria-label={`Thread cost ${usageLabel(report)}. Hover for the breakdown.`}
            className={cn(
              "inline-flex shrink-0 cursor-default items-center rounded-full bg-state-hover px-2 text-xs tabular-nums text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              placement === "footer" ? "h-5" : "h-6",
            )}
          >
            {usageLabel(report)}
          </button>
        </TooltipTrigger>
        <TooltipContent side={placement === "footer" ? "top" : "bottom"} align="end">
          <UsageCard report={report} reportedAt={reportedAt} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A thread header action, which bb always mounts, unlike a prompt-box action. It shows the pill beside
 * the context circle under the prompt box, or here in the header when that row is not on screen.
 */
export function BurnHeaderAction({ threadId }: PluginThreadHeaderActionProps): ReactNode {
  const { values } = useSettings();
  const { report, reportedAt } = useUsage(threadId);
  const visible = values?.chip !== false;
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const mount = useFooterMount(visible ? anchor : null);
  const pill = visible ? <BurnPill report={report ?? EMPTY_REPORT} reportedAt={reportedAt} placement={mount === null ? "header" : "footer"} /> : null;
  return (
    <span ref={setAnchor} className={visible && mount === null ? "inline-flex items-center" : "hidden"}>
      {pill !== null && mount !== null ? createPortal(pill, mount) : pill}
    </span>
  );
}
