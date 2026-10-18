import type { BbNavigate, JsonValue } from "@get-bb/plugin-sdk/app";

/** The `threadPanelAction` id of the Burn tab. */
export const PANEL_ACTION_ID = "burn";
const PENDING_MS = 10_000;

type Opener = (params: JsonValue | null) => boolean;

// Thread menus and toasts are app-wide, but a panel opens in one thread's side panel: only that thread's chip, a
// header action mounted in its pane, can open it there. Each mounted chip registers an opener for its thread.
const openers = new Map<string, Opener[]>();
let pending: { threadId: string; params: JsonValue | null; at: number } | null = null;

export function openPanelIn(navigate: BbNavigate, params: JsonValue | null): boolean {
  return navigate.openThreadPanel(params === null ? { actionId: PANEL_ACTION_ID } : { actionId: PANEL_ACTION_ID, params });
}

/** Registers the opener of a mounted chip, and runs a request that was waiting for this thread to open. */
export function registerPanelOpener(threadId: string, open: Opener, now: number = Date.now()): () => void {
  const list = openers.get(threadId) ?? [];
  list.push(open);
  openers.set(threadId, list);
  if (pending !== null && pending.threadId === threadId) {
    const request = pending;
    pending = null;
    if (now - request.at < PENDING_MS) open(request.params);
  }
  return () => {
    const left = (openers.get(threadId) ?? []).filter((o) => o !== open);
    if (left.length > 0) openers.set(threadId, left);
    else openers.delete(threadId);
  };
}

/**
 * Opens the Burn tab of `threadId`: in place when that thread is on screen,
 * otherwise by going to the thread and opening it once its chip mounts.
 */
export function requestPanel(navigate: BbNavigate, threadId: string, params: JsonValue | null, now: number = Date.now()): void {
  const list = openers.get(threadId);
  const open = list?.[list.length - 1];
  if (open !== undefined && open(params)) return;
  pending = { threadId, params, at: now };
  navigate.toThread(threadId);
}
