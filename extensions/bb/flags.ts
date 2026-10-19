import type { PluginComposerThreadRowStatus, PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { formatAmount, formatBudget } from "../../src/format.js";
import type { OverBudgetRow } from "./contract.js";
import { FLAME_ICON } from "./icon.js";

type RowStatus = PluginComposerThreadRowStatus;
type SetRowStatus = (threadId: string, status: RowStatus | null) => void;

// The app overlay knows which threads are over budget (it can call rpc); only the content script may set row
// statuses. Both live in this one bundle per window, so they meet here.
let setRowStatus: SetRowStatus | null = null;
let wanted: ReadonlyMap<string, RowStatus> = new Map();
const shown = new Map<string, string>();

function sync(): void {
  const set = setRowStatus;
  if (set === null) return;
  for (const id of [...shown.keys()]) {
    if (wanted.has(id)) continue;
    set(id, null);
    shown.delete(id);
  }
  for (const [id, status] of wanted) {
    const key = JSON.stringify(status);
    if (shown.get(id) === key) continue;
    set(id, status);
    shown.set(id, key);
  }
}

/** The flags the sidebar should show now; an empty map clears them all. */
export function setRowFlags(next: ReadonlyMap<string, RowStatus>): void {
  wanted = next;
  sync();
}

export const overBudgetStatus = (row: OverBudgetRow): RowStatus => ({
  icon: FLAME_ICON,
  label: `Over budget · ${formatAmount(row.cost, row.estimated)} of ${formatBudget(row.budget)}`,
  tone: "error",
});

/** The content script: hands the store the row-status setter while it is mounted, on clients that have one. */
export function mountRowFlags(context: PluginContentScriptContext): () => void {
  if (context.experimental_setThreadRowStatus === undefined) return () => {};
  const set: SetRowStatus = (threadId, status) => context.experimental_setThreadRowStatus?.(threadId, status);
  setRowStatus = set;
  shown.clear();
  sync();
  // The host clears this generation's statuses itself once it deactivates.
  return () => {
    shown.clear();
    if (setRowStatus === set) setRowStatus = null;
  };
}
