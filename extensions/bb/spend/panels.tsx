import { useRpc } from "@get-bb/plugin-sdk/app";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";
import { EyeOffIcon, SlidersIcon } from "../icon.js";
import { cn } from "../lib/utils.js";
import type { SpendPanel, spendMethods } from "./contract.js";

/** The page's panels in page order; a test keeps the ids equal to SPEND_PANELS. */
export const PANELS: readonly { id: SpendPanel; label: string; hint?: string }[] = [
  { id: "usage", label: "Usage cards", hint: "Tokens, calls, median call, failed calls" },
  { id: "chart", label: "Per day", hint: "The chart by day, or today's bar" },
  { id: "mix", label: "Token mix" },
  { id: "time", label: "Call time", hint: "pi threads only" },
  { id: "activity", label: "Activity by hour" },
  { id: "threads", label: "Threads", hint: "The ten biggest threads" },
  { id: "models", label: "Models" },
  { id: "projects", label: "By project" },
  { id: "harnesses", label: "By harness" },
];

const labelOf = (id: SpendPanel): string => PANELS.find((p) => p.id === id)?.label ?? id;
const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export interface Panels {
  /** The stored choice has loaded, or failed to. */
  ready: boolean;
  hidden: ReadonlySet<SpendPanel>;
  shown(id: SpendPanel): boolean;
  setShown(id: SpendPanel, shown: boolean): void;
  showAll(): void;
}

/** Which panels are hidden, kept by the plugin so every bb window shows the same ones. */
export function usePanels(): Panels {
  const rpc = useRpc<typeof spendMethods>();
  const [hidden, setHidden] = useState<ReadonlySet<SpendPanel>>(() => new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    rpc.call("spendPanels", {}).then(
      (panels) => {
        if (!live) return;
        setHidden(new Set(panels.hidden));
        setReady(true);
      },
      (cause: unknown) => {
        console.warn(`Burn: loading the hidden panels failed: ${errorText(cause)}`);
        if (live) setReady(true);
      },
    );
    return () => {
      live = false;
    };
  }, [rpc]);

  const save = useCallback(
    (next: ReadonlySet<SpendPanel>) => {
      setHidden(next);
      rpc.call("setSpendPanels", { hidden: PANELS.filter((p) => next.has(p.id)).map((p) => p.id) }).catch((cause: unknown) => {
        console.warn(`Burn: saving the hidden panels failed: ${errorText(cause)}`);
      });
    },
    [rpc],
  );

  return {
    ready,
    hidden,
    shown: (id) => !hidden.has(id),
    setShown: (id, shown) => {
      const next = new Set(hidden);
      if (shown) next.delete(id);
      else next.add(id);
      save(next);
    },
    showAll: () => save(new Set()),
  };
}

const HEADING = "px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase";

/** The toolbar's View menu: which calendar days count, above a switch for each panel. */
export function ViewMenu({ panels, days }: { panels: Panels; days: ReactNode }): ReactNode {
  const count = panels.hidden.size;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Until the stored choice loads, a change here could be overwritten by it.
          disabled={!panels.ready}
          aria-label={count > 0 ? `View, ${count} hidden` : "View"}
          title="Days and panels"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 data-[state=open]:bg-state-hover"
        >
          <SlidersIcon className="size-3.5 text-muted-foreground" />
          View
          {count > 0 ? (
            <span aria-hidden className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground px-1 text-[10px] font-semibold text-background tabular-nums">
              {count}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5 text-xs" aria-label="View">
        <div className={HEADING}>Days</div>
        <div className="px-2 pb-2">
          {days}
          <p className="mt-1.5 text-[11px] text-muted-foreground">Local is the bb machine's day. UTC is the day Shopify's AI proxy counts.</p>
        </div>
        <div className={HEADING}>Show on this page</div>
        {PANELS.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-state-hover">
            <span className="min-w-0 flex-1">
              <span className="block text-foreground">{p.label}</span>
              {p.hint !== undefined ? <span className="block text-[11px] text-muted-foreground">{p.hint}</span> : null}
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={p.label}
              checked={panels.shown(p.id)}
              onChange={(e) => panels.setShown(p.id, e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-[15px] w-[26px] shrink-0 rounded-full bg-muted transition-colors after:absolute after:top-[2px] after:left-[2px] after:size-[11px] after:rounded-full after:bg-muted-foreground after:transition-transform peer-checked:bg-timeline-accent peer-checked:after:translate-x-[11px] peer-checked:after:bg-background peer-focus-visible:ring-1 peer-focus-visible:ring-ring"
            />
          </label>
        ))}
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
          <span>Kept by Burn for every bb window</span>
          <button
            type="button"
            disabled={count === 0}
            onClick={panels.showAll}
            className="rounded-sm text-xs text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:no-underline"
          >
            Show all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A panel's own hide button, shown while the pointer is over its `group`, or on focus. */
export function HideButton({ id, panels }: { id: SpendPanel; panels: Panels }): ReactNode {
  const label = `Hide ${labelOf(id)}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => panels.setShown(id, false)}
      className={cn(
        "inline-flex size-[18px] items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      <EyeOffIcon className="size-[13px]" />
    </button>
  );
}

/** A panel's heading, with an aside and its hide button on the right. */
export function PanelLabel({ children, aside, hide }: { children: ReactNode; aside?: ReactNode; hide?: ReactNode }): ReactNode {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
      {aside !== undefined || hide !== undefined ? (
        <span className="inline-flex items-center gap-1.5">
          {aside}
          {hide}
        </span>
      ) : null}
    </div>
  );
}
