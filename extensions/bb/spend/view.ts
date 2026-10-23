import type { SpendMetric, SpendRange, SpendZone } from "./contract.js";

export type Prices = "discounted" | "list";

/** The Burn page's choices, kept on this device so the page opens as it was left. */
export interface SavedView {
  range: SpendRange;
  metric: SpendMetric;
  projectId: string | null;
  tz: SpendZone;
  prices: Prices;
}

export const VIEW_KEY = "burn.spend.view";
/** Where Burn 0.5 kept the Local or UTC choice, read until the page first saves its choices. */
const OLD_ZONE_KEY = "burn.spend.tz";
const PROJECT_ID_MAX = 100;

export const DEFAULT_VIEW: SavedView = { range: "7d", metric: "cost", projectId: null, tz: "local", prices: "discounted" };

// The app leaves zod out, so these are listed here; a test keeps them equal to the contract's.
export const VIEW_CHOICES = {
  range: ["today", "7d", "30d"] satisfies readonly SpendRange[],
  metric: ["cost", "tokens", "calls"] satisfies readonly SpendMetric[],
  tz: ["local", "utc"] satisfies readonly SpendZone[],
  prices: ["discounted", "list"] satisfies readonly Prices[],
};

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

function pick<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.find((c) => c === value) ?? fallback;
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadView(): SavedView {
  try {
    const saved = parse(localStorage.getItem(VIEW_KEY));
    const tz = saved === null ? (localStorage.getItem(OLD_ZONE_KEY) === "utc" ? "utc" : DEFAULT_VIEW.tz) : saved.tz;
    const { projectId } = saved ?? {};
    return {
      range: pick(VIEW_CHOICES.range, saved?.range, DEFAULT_VIEW.range),
      metric: pick(VIEW_CHOICES.metric, saved?.metric, DEFAULT_VIEW.metric),
      projectId: typeof projectId === "string" && projectId.length <= PROJECT_ID_MAX ? projectId : null,
      tz: pick(VIEW_CHOICES.tz, tz, DEFAULT_VIEW.tz),
      prices: pick(VIEW_CHOICES.prices, saved?.prices, DEFAULT_VIEW.prices),
    };
  } catch {
    // Storage is blocked in some sandboxed frames; the page then opens on the defaults.
    return DEFAULT_VIEW;
  }
}

export function saveView(view: SavedView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch (cause) {
    console.warn(`Burn: remembering the Burn page's choices failed: ${errorText(cause)}`);
  }
}
