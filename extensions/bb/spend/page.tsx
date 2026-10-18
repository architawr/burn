import {
  type PluginNavPanelProps,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { budgetState } from "../../../src/budget.js";
import { formatBudget, formatUsd, modelName, providerName } from "../../../src/format.js";
import { cn } from "../lib/utils.js";
import type { SpendOutput, SpendRange, spendMethods } from "./contract.js";
import { dayDate, RANGE_DAYS } from "./days.js";

/** A usage signal arrives per report from every running thread, so refetches wait for a quiet moment. */
export const REFETCH_DEBOUNCE_MS = 1000;

const RANGES: { range: SpendRange; label: string; column: string; previous: string }[] = [
  { range: "today", label: "Today", column: "Today", previous: "yesterday" },
  { range: "7d", label: "7 days", column: "Last 7 days", previous: "previous 7 days" },
  { range: "30d", label: "30 days", column: "Last 30 days", previous: "previous 30 days" },
];
const rangeInfo = (range: SpendRange) => RANGES.find((r) => r.range === range) ?? (RANGES[1] as (typeof RANGES)[number]);

/** bb's categorical chart series, each falling back to a host token where a theme does not define it. */
const CHART = [
  "var(--chart-1, var(--timeline-accent))",
  "var(--chart-2, var(--success))",
  "var(--chart-3, var(--warning))",
  "var(--chart-4, var(--ansi-5))",
  "var(--chart-5, var(--ansi-6))",
  "var(--chart-6, var(--destructive))",
];
const chartColor = (i: number): CSSProperties => ({ color: CHART[i % CHART.length] });
const PROJECT_COLOR = chartColor(4);
const RUNNING_COLOR: CSSProperties = { color: "var(--chart-1, var(--timeline-accent))" };

const EMPTY_TEXT = "No pi threads have reported yet. Threads report after they start with Burn installed.";

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

interface SpendState {
  data: SpendOutput | null;
  error: string | null;
  loading: boolean;
}

/** Spend for the range and project, refetched (debounced) on every usage signal and after a reconnect. */
function useSpend(range: SpendRange, projectId: string | null): SpendState & { retry: () => void } {
  const rpc = useRpc<typeof spendMethods>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<SpendState>({ data: null, error: null, loading: true });
  const latest = useRef(0);
  const lastConnection = useRef(connection);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    const asked = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    rpc.call("spend", { range, projectId }).then(
      (data) => {
        if (asked === latest.current) setState({ data, error: null, loading: false });
      },
      (cause: unknown) => {
        if (asked === latest.current) setState((s) => ({ ...s, error: errorText(cause), loading: false }));
      },
    );
  }, [rpc, range, projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useRealtime(
    "usage",
    useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        refetch();
      }, REFETCH_DEBOUNCE_MS);
    }, [refetch]),
  );
  useEffect(() => {
    if (connection === "connected" && lastConnection.current !== "connected") refetch();
    lastConnection.current = connection;
  }, [connection, refetch]);

  return { ...state, retry: refetch };
}

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
      {aside}
    </div>
  );
}

function Toolbar({
  range,
  onRange,
  projectId,
  onProject,
  options,
}: {
  range: SpendRange;
  onRange: (range: SpendRange) => void;
  projectId: string | null;
  onProject: (projectId: string | null) => void;
  options: SpendOutput["projectOptions"];
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        aria-label="Project"
        value={projectId ?? ""}
        onChange={(e) => onProject(e.target.value === "" ? null : e.target.value)}
        className="h-7 max-w-[14rem] truncate rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All projects</option>
        {options.map((p) => (
          <option key={p.projectId} value={p.projectId}>
            {p.name}
          </option>
        ))}
      </select>
      <div role="group" aria-label="Range" className="inline-flex rounded-md bg-surface-recessed p-0.5 text-xs">
        {RANGES.map((r) => (
          <button
            key={r.range}
            type="button"
            aria-pressed={r.range === range}
            onClick={() => onRange(r.range)}
            className={cn(
              "rounded-[5px] px-2.5 py-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              r.range === range ? "bg-accent text-accent-foreground" : "hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, hint }: { label: string; value: string; sub: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised p-3" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Change({ total, previous, range }: { total: number; previous: number; range: SpendRange }) {
  const { previous: than } = rangeInfo(range);
  if (previous === 0) return <>no spend {range === "today" ? than : `in the ${than}`}</>;
  const pct = Math.round(((total - previous) / previous) * 100);
  if (pct === 0) return <>same as {than}</>;
  return (
    <>
      <span className={pct > 0 ? "text-warning-text" : undefined}>
        {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
      </span>{" "}
      vs {than}
    </>
  );
}

function Kpis({ data }: { data: SpendOutput }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Kpi label="Spent" value={formatUsd(data.total)} sub={<Change total={data.total} previous={data.previousTotal} range={data.range} />} />
      <Kpi
        label="Threads"
        value={String(data.threadCount)}
        sub={data.overBudgetCount > 0 ? `${data.overBudgetCount} over budget` : "none over budget"}
      />
      <Kpi
        label="Median thread"
        value={data.medianThreadCost === null ? "—" : formatUsd(data.medianThreadCost)}
        sub={data.perCall === null ? "no calls" : `${formatUsd(data.perCall)} per call`}
      />
      <Kpi
        label="Cache hit rate"
        value={data.cacheHitPct === null ? "—" : `${Math.round(data.cacheHitPct)}%`}
        sub="of prompt tokens"
        hint="Cache reads as a share of prompt tokens, from the session totals of the threads in range"
      />
    </div>
  );
}

function Legend({ models }: { models: SpendOutput["models"] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Models">
      {models.map((m, i) => (
        <li key={m.key} className="flex items-center gap-1.5" title={m.key}>
          <span aria-hidden className="size-2 rounded-[2px] bg-current" style={chartColor(i)} />
          {modelName(m.key)}
        </li>
      ))}
    </ul>
  );
}

/** About three round gridlines that cover `peak`. */
function scale(peak: number): { max: number; ticks: number[] } {
  if (!(peak > 0)) return { max: 1, ticks: [0] };
  const raw = peak / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  const max = Math.ceil(peak / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}

const axisLabel = (v: number): string => (v >= 1 || v === 0 ? formatBudget(Math.round(v * 100) / 100) : `$${v.toFixed(2)}`);
const shortDay = (day: string, range: SpendRange): string =>
  range === "7d"
    ? dayDate(day).toLocaleDateString("en-US", { weekday: "short" })
    : dayDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const longDay = (day: string): string =>
  dayDate(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Beside the hovered day, on the side with more room, so it never covers that day's bar. */
function DayTip({ day, models, index, count }: { day: SpendOutput["days"][number]; models: SpendOutput["models"]; index: number; count: number }) {
  const right = index < count / 2;
  const edge = ((right ? index + 1 : index) / count) * 100;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
      style={{ left: `${edge}%`, transform: right ? "translateX(6px)" : "translateX(calc(-100% - 6px))" }}
    >
      <div className="mb-1 font-semibold whitespace-nowrap">
        {longDay(day.day)} · {formatUsd(day.cost)}
      </div>
      {day.models.length === 0 ? <div className="text-muted-foreground">No spend</div> : null}
      {day.models.map((m) => {
        const i = models.findIndex((x) => x.key === m.key);
        return (
          <div key={m.key} className="flex items-center justify-between gap-3 tabular-nums">
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-current" style={chartColor(i)} />
              <span className="truncate">{modelName(m.key)}</span>
            </span>
            <span>{formatUsd(m.cost)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DayChart({ data }: { data: SpendOutput }) {
  const { days, models, dailyBudget, range } = data;
  const [hover, setHover] = useState<number | null>(null);
  const { max, ticks } = scale(Math.max(dailyBudget ?? 0, ...days.map((d) => d.cost)));
  const pct = (v: number): number => Math.min(100, (v / max) * 100);
  const hovered = hover === null ? undefined : days[hover];
  const labelled = (i: number): boolean => range === "7d" || (days.length - 1 - i) % 5 === 0;
  return (
    <div className="pl-10" onMouseLeave={() => setHover(null)}>
      <div className="relative h-36">
        {ticks.map((t) => (
          <div key={t} aria-hidden className="absolute inset-x-0" style={{ bottom: `${pct(t)}%` }}>
            <div className={cn("border-t border-border", t > 0 && "border-dashed")} />
            <span className="absolute right-full mr-2 translate-y-[-50%] text-[10px] text-muted-foreground tabular-nums">{axisLabel(t)}</span>
          </div>
        ))}
        {dailyBudget !== null ? (
          <div className="pointer-events-none absolute inset-x-0 z-[1]" style={{ bottom: `${pct(dailyBudget)}%` }}>
            <div className="border-t border-dashed border-warning" />
            <span className="absolute right-0 bottom-0.5 rounded-sm bg-background px-1 text-[10px] text-warning-text">Daily budget {formatBudget(dailyBudget)}</span>
          </div>
        ) : null}
        <div className="absolute inset-0 flex" role="list" aria-label="Spend per day">
          {days.map((d, i) => (
            <div
              key={d.day}
              role="listitem"
              tabIndex={0}
              aria-label={`${longDay(d.day)}: ${formatUsd(d.cost)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={cn(
                "flex h-full min-w-0 flex-1 justify-center rounded-sm transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                hover !== null && hover !== i && "opacity-45",
              )}
            >
              <div className="flex h-full w-[56%] max-w-10 flex-col-reverse gap-px">
                {d.models.map((m) => (
                  <div
                    key={m.key}
                    className="w-full shrink-0 rounded-[2px] bg-current"
                    style={{ ...chartColor(models.findIndex((x) => x.key === m.key)), height: `${pct(m.cost)}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {hovered !== undefined && hover !== null ? (
          <DayTip day={hovered} models={models} index={hover} count={days.length} />
        ) : null}
      </div>
      <div aria-hidden className="mt-1 flex text-[10.5px] text-muted-foreground">
        {days.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {labelled(i) ? shortDay(d.day, range) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One day has no shape over time, so today reads as its split by model against the Daily budget. */
function TodayBar({ data }: { data: SpendOutput }) {
  const { models, dailyBudget, total } = data;
  // Headroom past the larger of the two, so the budget mark never sits on the bar's rounded end.
  const span = Math.max(total, dailyBudget ?? 0) * 1.08 || 1;
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground tabular-nums">
        <span className="text-sm font-semibold text-foreground">{formatUsd(total)}</span> today
        {dailyBudget !== null ? ` of the ${formatBudget(dailyBudget)} daily budget` : ""}
      </div>
      <div className="relative">
        <div className="flex h-3 gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label={`Today by model: ${formatUsd(total)}`}>
          {models.map((m, i) => (
            <div key={m.key} className="h-full bg-current" style={{ ...chartColor(i), width: `${(m.cost / span) * 100}%` }} />
          ))}
        </div>
        {dailyBudget !== null ? (
          <div
            aria-hidden
            className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-warning"
            style={{ left: `${Math.min(100, (dailyBudget / span) * 100)}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ThreadTable({ data }: { data: SpendOutput }) {
  const navigate = useBbNavigate();
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Costliest threads
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Calls
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">
              {rangeInfo(data.range).column}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Total
            </th>
            <th scope="col" className="w-0 px-3 py-2">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.threads.length === 0 ? (
            <tr className="border-t border-border">
              <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                No thread spent anything in this period.
              </td>
            </tr>
          ) : null}
          {data.threads.map((t) => {
            const over = budgetState(t.total, t.budget) === "over";
            const detail = [
              t.projectName,
              t.model,
              t.childCount > 0 ? `${t.childCount} ${t.childCount === 1 ? "child thread" : "child threads"}` : null,
            ].filter((s): s is string => s !== null);
            return (
              <tr
                key={t.threadId}
                data-testid="spend-thread"
                onClick={() => navigate.toThread(t.threadId)}
                className="cursor-pointer border-t border-border hover:bg-state-hover"
              >
                <td className="max-w-0 px-3 py-2">
                  <button
                    type="button"
                    className="block max-w-full truncate rounded-sm text-left text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {t.title}
                  </button>
                  {detail.length > 0 ? <div className="truncate text-[11px] text-muted-foreground">{detail.join(" · ")}</div> : null}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{t.calls}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatUsd(t.rangeCost)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatUsd(t.total)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className="inline-flex gap-1">
                    {over && t.budget !== null ? (
                      <span className="rounded-full bg-current/15 px-1.5 py-px text-[10.5px] font-semibold text-destructive-text">
                        over {formatBudget(t.budget)}
                      </span>
                    ) : null}
                    {t.running ? (
                      <span className="rounded-full bg-current/15 px-1.5 py-px text-[10.5px] font-semibold" style={RUNNING_COLOR}>
                        running
                      </span>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ label, rows }: { label: string; rows: { key: string; name: string; hint?: string; cost: number; color: CSSProperties }[] }) {
  const peak = Math.max(0, ...rows.map((r) => r.cost)) || 1;
  return (
    <section aria-label={label}>
      <Label>{label}</Label>
      {rows.length === 0 ? <div className="text-xs text-muted-foreground">No spend in this period.</div> : null}
      <div className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-x-2 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <span className="truncate" title={r.hint ?? r.name}>
              {r.name}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-current" style={{ ...r.color, width: `${(r.cost / peak) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{formatUsd(r.cost)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Dashboard({ data }: { data: SpendOutput }) {
  return (
    <>
      <Kpis data={data} />
      <section aria-label={data.range === "today" ? "Today" : "Per day"}>
        <Label aside={data.models.length > 0 ? <Legend models={data.models} /> : null}>{data.range === "today" ? "Today" : "Per day"}</Label>
        {data.range === "today" ? <TodayBar data={data} /> : <DayChart data={data} />}
      </section>
      <ThreadTable data={data} />
      <div className="grid gap-5 md:grid-cols-2">
        <Bars
          label="By project"
          rows={data.projects.map((p) => ({ key: p.projectId ?? "", name: p.name, cost: p.cost, color: PROJECT_COLOR }))}
        />
        <Bars
          label="By model"
          rows={data.models.map((m, i) => ({
            key: m.key,
            name: modelName(m.key),
            hint: providerName(m.key) ? m.key : undefined,
            cost: m.cost,
            color: chartColor(i),
          }))}
        />
      </div>
    </>
  );
}

function Notice({ role, children }: { role: "status" | "alert"; children: ReactNode }) {
  return (
    <div role={role} className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** The Burn page: what every pi thread has spent, by day, thread, project and model. */
export function SpendPage({ subPath }: PluginNavPanelProps): ReactNode {
  const [range, setRange] = useState<SpendRange>(() =>
    Object.hasOwn(RANGE_DAYS, subPath) ? (subPath as SpendRange) : "7d",
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data, error, loading, retry } = useSpend(range, projectId);

  let body: ReactNode;
  if (data === null) {
    body = error !== null ? (
      <Notice role="alert">
        <div>Could not load spend: {error}</div>
        <button type="button" onClick={retry} className="mt-3 rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-state-hover">
          Try again
        </button>
      </Notice>
    ) : (
      <Notice role="status">Loading spend…</Notice>
    );
  } else if (data.reportedThreads === 0) {
    body = <Notice role="status">{EMPTY_TEXT}</Notice>;
  } else {
    body = (
      <>
        {error !== null ? (
          <div role="alert" className="text-xs text-destructive-text">
            Could not refresh: {error}
          </div>
        ) : null}
        <Dashboard data={data} />
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className={cn("mx-auto w-full max-w-4xl space-y-5 text-foreground", loading && data !== null && "opacity-70")} aria-busy={loading}>
        <Toolbar range={range} onRange={setRange} projectId={projectId} onProject={setProjectId} options={data?.projectOptions ?? []} />
        {body}
      </div>
    </div>
  );
}
