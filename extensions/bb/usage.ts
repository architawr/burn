import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { rpcContract, UsageAnswer } from "./contract.js";

export const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** schema.ts#THREAD_ID without importing zod into the app bundle. */
export const isThreadId = (id: string): boolean => /^thr_[0-9a-z]{6,40}$/.test(id);

/** The thread a `usage` signal is about, or null for one that names none (every thread). */
export function signalThread(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { threadId?: unknown }).threadId;
  return typeof id === "string" ? id : null;
}

/** Runs `onChange` after a reconnect: plugin signals are not replayed, so anything may have changed meanwhile. */
export function useOnReconnect(onChange: () => void): void {
  const connection = useRealtimeConnectionState();
  const last = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && last.current !== "connected") onChange();
    last.current = connection;
  }, [connection, onChange]);
}

/** How often a figure read from a session log is refreshed: no signal says when such a thread spends. */
export const LOG_REFRESH_MS = 60_000;

/**
 * The thread's usage, refetched on its own `usage` signal (and its children's
 * when `withChildren`), after a reconnect, and every LOG_REFRESH_MS while
 * it comes from a session log.
 */
export function useUsage(
  threadId: string,
  opts: { withChildren?: boolean } = {},
): { answer: UsageAnswer | null; error: string | null; refetch: () => void } {
  const rpc = useRpc<typeof rpcContract>();
  const [answer, setAnswer] = useState<UsageAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const children = useRef<ReadonlySet<string>>(new Set());

  const refetch = useCallback(() => {
    const asked = ++latest.current;
    rpc.call("usage", { threadId }).then(
      (next) => {
        if (asked !== latest.current) return;
        children.current = new Set(next.family.children.map((c) => c.threadId));
        setAnswer(next);
        setError(null);
      },
      (cause: unknown) => {
        if (asked === latest.current) setError(errorText(cause));
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    setAnswer(null);
    refetch();
  }, [refetch]);
  const withChildren = opts.withChildren === true;
  useRealtime(
    "usage",
    useCallback(
      (payload: unknown) => {
        const about = signalThread(payload);
        if (about === null || about === threadId || (withChildren && children.current.has(about))) refetch();
      },
      [threadId, withChildren, refetch],
    ),
  );
  useOnReconnect(refetch);
  const fromLog = answer?.source === "log";
  useEffect(() => {
    if (!fromLog) return;
    const timer = setInterval(refetch, LOG_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fromLog, refetch]);
  return { answer, error, refetch };
}

/** Date.now(), refreshed every `everyMs` while mounted. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
