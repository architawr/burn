import { type BbNavigate, useBbNavigate, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ALERT_CHANNEL, type BurnAlert, isBurnAlert } from "./alerts.js";
import type { rpcContract } from "./contract.js";
import { overBudgetStatus, setRowFlags } from "./flags.js";
import { requestPanel } from "./panel-requests.js";
import { readPrefs } from "./prefs.js";
import { errorText, useOnReconnect } from "./usage.js";

const SEEN_MAX = 500;
const REFRESH_MS = 1000;

// One overlay mounts per window, so this is "once per window".
const seen = new Set<string>();

/** Shows an alert as a toast unless this window already showed it; says whether it did. */
export function showAlert(alert: BurnAlert, navigate: BbNavigate): boolean {
  if (seen.has(alert.id)) return false;
  seen.add(alert.id);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string);
  const { threadId } = alert;
  const action =
    threadId === null
      ? { label: "Open Spend", onClick: () => navigate.toPluginPanel("spend") }
      : alert.kind === "expensive"
        ? { label: "Open details", onClick: () => requestPanel(navigate, threadId, null) }
        : { label: "Open thread", onClick: () => navigate.toThread(threadId) };
  const options = { id: alert.id, description: alert.body, action };
  if (alert.kind === "over" || alert.kind === "stopped") toast.error(alert.title, options);
  else if (alert.kind === "expensive") toast(alert.title, options);
  else toast.warning(alert.title, options);
  return true;
}

/**
 * Mounted once per window: shows each Burn alert as a toast and keeps the
 * sidebar's over-budget flags current while that setting is on.
 */
export function BurnOverlay(): ReactNode {
  const { flagOverBudget, threadBudget } = readPrefs(useSettings().values);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    const asked = ++latest.current;
    if (!flagOverBudget) {
      setRowFlags(new Map());
      return;
    }
    rpc.call("overBudget", {}).then(
      ({ threads }) => {
        if (asked === latest.current) setRowFlags(new Map(threads.map((t) => [t.threadId, overBudgetStatus(t)])));
      },
      (cause: unknown) => console.warn(`Burn: checking which threads are over budget failed: ${errorText(cause)}`),
    );
  }, [rpc, flagOverBudget]);

  // refresh does not read threadBudget, but a new one moves threads over or under their budget.
  useEffect(refresh, [refresh, threadBudget]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      latest.current++;
      setRowFlags(new Map());
    },
    [],
  );
  useRealtime(
    "usage",
    useCallback(() => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refresh, REFRESH_MS);
    }, [refresh]),
  );
  useOnReconnect(refresh);
  useRealtime(
    ALERT_CHANNEL,
    useCallback(
      (payload: unknown) => {
        if (isBurnAlert(payload)) showAlert(payload, navigate);
      },
      [navigate],
    ),
  );
  return null;
}
