import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { buildReport, type EntryLike, type UsageReport } from "../../src/report.js";

/**
 * bb's pi bridge keeps each pi session as `<dataDir>/pi-bridge-sessions/<id>.jsonl`,
 * named after the thread's provider thread id. thread-spend reads the same files.
 */
const SESSIONS_DIR = "pi-bridge-sessions";
const IDS_TTL_MS = 5 * 60_000;
const CACHE_MAX = 1000;

export const sessionPath = (dataDir: string, providerThreadId: string): string =>
  join(dataDir, SESSIONS_DIR, `${providerThreadId.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);

/** A report read from a thread's session logs; `at` is when the newest log last changed. */
export interface LogReport {
  report: UsageReport;
  at: number;
}

const isEntry = (v: unknown): v is EntryLike =>
  typeof v === "object" && v !== null && typeof (v as EntryLike).type === "string" && typeof (v as EntryLike).timestamp === "string";

/** The entries of a session log, without its header. */
export function parseSessionLog(text: string): EntryLike[] {
  const entries: EntryLike[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // pi may be writing the last line right now; the next read gets it whole.
      continue;
    }
    if (isEntry(entry) && entry.type !== "session") entries.push(entry);
  }
  return entries;
}

interface Cached {
  checkedAt: number;
  signature: string;
  value: LogReport | null;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * Reports for threads whose pi never reported to Burn (started before Burn was
 * installed, or a child the parent started then), read from their session logs
 * on this machine. A log is reread only after it changes, and checked at most
 * once per `ttlMs`, so a running thread's log is not reparsed on every call.
 */
export function createLogReports(
  bb: BbPluginApi,
  opts: { dataDir?: string; now?: () => number; ttlMs?: number } = {},
): { reportOf(threadId: string): Promise<LogReport | null>; forget(threadId: string): void } {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? 15_000;
  const ids = new Map<string, { at: number; ids: string[] }>();
  const cache = new Map<string, Cached>();

  async function sessionIds(threadId: string): Promise<string[]> {
    const held = ids.get(threadId);
    if (held && now() - held.at < IDS_TTL_MS) return held.ids;
    const rows = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"] });
    const found = [
      ...new Set(
        rows.flatMap((row) => {
          const id = (row.data as { providerThreadId?: unknown } | null)?.providerThreadId;
          return typeof id === "string" && id !== "" ? [id] : [];
        }),
      ),
    ];
    remember(ids, threadId, { at: now(), ids: found });
    return found;
  }

  async function files(threadId: string): Promise<{ path: string; mtimeMs: number; size: number }[]> {
    const dataDir = opts.dataDir ?? bb.server.experimental_dataDir;
    const out: { path: string; mtimeMs: number; size: number }[] = [];
    for (const id of await sessionIds(threadId)) {
      const path = sessionPath(dataDir, id);
      try {
        const info = await stat(path);
        out.push({ path, mtimeMs: info.mtimeMs, size: info.size });
      } catch (err) {
        // A thread on another host keeps its log there.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") bb.log.warn(`reading ${path} failed: ${message(err)}`);
      }
    }
    return out;
  }

  async function read(found: { path: string; mtimeMs: number }[]): Promise<LogReport | null> {
    if (found.length === 0) return null;
    const sessions = await Promise.all(found.map(async (f) => parseSessionLog(await readFile(f.path, "utf8"))));
    const first = (entries: EntryLike[]): number => Date.parse(entries[0]?.timestamp ?? "") || 0;
    const entries = sessions.sort((a, b) => first(a) - first(b)).flat();
    return { report: buildReport(entries, null), at: Math.max(...found.map((f) => f.mtimeMs)) };
  }

  return {
    async reportOf(threadId) {
      const held = cache.get(threadId);
      if (held && now() - held.checkedAt < ttlMs) return held.value;
      try {
        const found = await files(threadId);
        const signature = found.map((f) => `${f.path}:${f.mtimeMs}:${f.size}`).join("|");
        const value = held?.signature === signature ? held.value : await read(found);
        remember(cache, threadId, { checkedAt: now(), signature, value });
        return value;
      } catch (err) {
        bb.log.warn(`reading the session log of ${threadId} failed: ${message(err)}`);
        return held?.value ?? null;
      }
    },
    forget(threadId) {
      ids.delete(threadId);
      cache.delete(threadId);
    },
  };
}
