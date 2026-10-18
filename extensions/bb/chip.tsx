import { type PluginThreadHeaderActionProps, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { budgetFraction, budgetState } from "../../src/budget.js";
import { formatAgo, formatBudget, formatDelta, formatTokens, formatUsd, isTokenOnly } from "../../src/format.js";
import { BurnCard } from "./card.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import type { UsageAnswer } from "./contract.js";
import { useFooterMount } from "./footer.js";
import { FlameIcon } from "./icon.js";
import { cn } from "./lib/utils.js";
import { openPanelIn, registerPanelOpener } from "./panel-requests.js";
import { readPrefs } from "./prefs.js";
import { copySummary } from "./summary.js";
import { useNow, useUsage } from "./usage.js";

/** A running thread whose report is this old has stopped reporting. */
export const STALE_MS = 5 * 60_000;
const FRESH_MS = 6000;
const FADE_MS = 600;

export type ChipTone = "default" | "near" | "over" | "waiting";

export interface ChipView {
  tone: ChipTone;
  value: string;
  unit: string | null;
  /** The delta, the budget (" / $10") or the age of a report that stopped coming. */
  suffix: { kind: "delta" | "budget" | "age"; text: string } | null;
  /** How far along the budget (at most 1), for the line under a chip near or over it. */
  progress: number | null;
  running: boolean;
  stale: boolean;
  tokenOnly: boolean;
  label: string;
  title: string;
}

const WAITING_TITLE =
  "Waiting for pi to report. Restart this thread so pi can report: a thread started before Burn was installed reports after a restart.";

/** What the chip shows for an answer; pure so every state can be tested. */
export function chipView(answer: UsageAnswer | null, opts: { now: number; fresh: boolean; chipShows: "delta" | "cost" }): ChipView {
  const report = answer?.report ?? null;
  if (report === null) {
    return {
      tone: "waiting",
      value: "—",
      unit: null,
      suffix: null,
      progress: null,
      running: false,
      stale: false,
      tokenOnly: false,
      label: "Thread cost: waiting for pi to report. Click for details.",
      title: WAITING_TITLE,
    };
  }
  const tokenOnly = isTokenOnly(report);
  const t = report.tokens;
  const value = tokenOnly ? formatTokens(t.input + t.output + t.cacheRead + t.cacheWrite) : formatUsd(report.cost.total);
  const reportedAt = answer?.reportedAt ?? opts.now;
  const stale = report.running && opts.now - reportedAt >= STALE_MS;
  const budget = answer?.budget?.amount ?? null;
  const state = tokenOnly ? "none" : budgetState(report.cost.total, budget);
  const tone: ChipTone = state === "near" || state === "over" ? state : "default";
  const running = report.running && !stale;
  let suffix: ChipView["suffix"] = null;
  if (stale) suffix = { kind: "age", text: `· ${formatAgo(reportedAt, opts.now)}` };
  else if (tone !== "default" && budget !== null) suffix = { kind: "budget", text: `/ ${formatBudget(budget)}` };
  else if (opts.chipShows === "delta" && !tokenOnly && (running || opts.fresh)) suffix = { kind: "delta", text: formatDelta(report.lastTurnCost) };
  const total = `${value}${tokenOnly ? " tok" : ""}`;
  const budgetNote = budget !== null && !tokenOnly ? ` of ${formatBudget(budget)}` : "";
  return {
    tone,
    value,
    unit: tokenOnly ? "tok" : null,
    suffix,
    progress: tone === "default" ? null : Math.min(1, budgetFraction(report.cost.total, budget) ?? 0),
    running,
    stale,
    tokenOnly,
    label: `Thread cost ${total}${budgetNote}. Click for the breakdown.`,
    title: stale
      ? `Thread cost ${total}. pi has not reported for ${formatAgo(reportedAt, opts.now)} while it was working.`
      : answer?.source === "log"
        ? `Thread cost ${total}${budgetNote}, read from pi's session log because this thread does not report to Burn. Restart it for live updates and budgets.`
        : `Thread cost ${total}${budgetNote}${running ? ", pi is working" : ""}. Click for the breakdown.`,
  };
}

/** "in" for a few seconds after the total changes (not on the first report), then "out" while it fades. */
function useFreshness(total: number | null): "in" | "out" | null {
  const [phase, setPhase] = useState<"in" | "out" | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = total;
    if (prev === null || total === null || total === prev) return;
    setPhase("in");
    const fade = setTimeout(() => setPhase("out"), FRESH_MS - FADE_MS);
    const gone = setTimeout(() => setPhase(null), FRESH_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [total]);
  return phase;
}

const TONES: Record<ChipTone, { chip: string; flame: string }> = {
  default: { chip: "bg-state-hover text-foreground", flame: "text-warning" },
  near: { chip: "bg-warning/15 text-warning-text", flame: "text-warning" },
  over: { chip: "bg-destructive/15 text-destructive-text", flame: "text-destructive" },
  waiting: { chip: "border-dashed border-border bg-transparent text-muted-foreground", flame: "text-muted-foreground" },
};

function ChipFace({ view, fresh, placement }: { view: ChipView; fresh: "in" | "out" | null; placement: "footer" | "header" }) {
  const tone = TONES[view.tone];
  const suffix = view.suffix;
  return (
    <>
      <FlameIcon className={view.tokenOnly ? "text-muted-foreground" : tone.flame} />
      <b className="font-semibold">{view.value}</b>
      {view.unit !== null ? <span className="text-muted-foreground">{view.unit}</span> : null}
      {suffix !== null ? (
        <span
          data-suffix={suffix.kind}
          className={cn(
            suffix.kind === "delta" ? "text-muted-foreground" : "opacity-80",
            suffix.kind === "delta" && fresh === "in" && !view.running && "text-success animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
            suffix.kind === "delta" && fresh === "out" && !view.running && "text-success opacity-0 transition-opacity duration-500",
            "motion-reduce:animate-none motion-reduce:transition-none",
          )}
        >
          {suffix.text}
        </span>
      ) : null}
      {view.progress !== null ? (
        <i
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-0.5 bg-current opacity-70"
          style={{ width: `${view.progress * 100}%` }}
        />
      ) : null}
      {view.running ? <span aria-hidden="true" data-burn-shimmer="" data-placement={placement} className="pointer-events-none absolute inset-0" /> : null}
    </>
  );
}

function BurnChip({ threadId, answer, placement }: { threadId: string; answer: UsageAnswer | null; placement: "footer" | "header" }) {
  const prefs = readPrefs(useSettings().values);
  const navigate = useBbNavigate();
  const now = useNow(30_000);
  const fresh = useFreshness(answer?.report?.cost.total ?? null);
  const [open, setOpen] = useState(false);
  const view = chipView(answer, { now, fresh: fresh !== null, chipShows: prefs.chipShows });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-burn-chip-button=""
          data-placement={placement}
          data-tone={view.tone}
          data-running={view.running ? "" : undefined}
          aria-label={view.label}
          title={view.title}
          className={cn(
            "relative inline-flex shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-full border border-transparent pr-2 pl-1.5 text-xs whitespace-nowrap tabular-nums",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:ring-1 data-[state=open]:ring-ring",
            placement === "footer" ? "h-5" : "h-6",
            TONES[view.tone].chip,
            view.stale && "opacity-60",
          )}
        >
          <ChipFace view={view} fresh={fresh} placement={placement} />
        </button>
      </PopoverTrigger>
      <PopoverContent side={placement === "footer" ? "top" : "bottom"} align="end" className="w-[340px] p-0" aria-label="Burn: what this thread cost">
        <BurnCard
          answer={answer}
          threadId={threadId}
          defaultBudget={prefs.threadBudget}
          now={now}
          onOpenDetails={() => {
            setOpen(false);
            openPanelIn(navigate, null);
          }}
          onCopy={async () => (answer?.report ? copySummary(answer.report, answer.title, answer.budget) : false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A thread header action, which bb always mounts, unlike a prompt-box action. It shows the chip beside
 * the context circle under the prompt box, or here in the header when that row is not on screen.
 */
export function BurnHeaderAction({ threadId }: PluginThreadHeaderActionProps): ReactNode {
  const prefs = readPrefs(useSettings().values);
  const navigate = useBbNavigate();
  const { answer } = useUsage(threadId);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const mount = useFooterMount(prefs.chip ? anchor : null);
  useEffect(() => registerPanelOpener(threadId, (params) => openPanelIn(navigate, params)), [threadId, navigate]);
  const chip = prefs.chip ? <BurnChip threadId={threadId} answer={answer} placement={mount === null ? "header" : "footer"} /> : null;
  return (
    <span ref={setAnchor} className={prefs.chip && mount === null ? "inline-flex items-center" : "hidden"}>
      {chip !== null && mount !== null ? createPortal(chip, mount) : chip}
    </span>
  );
}
