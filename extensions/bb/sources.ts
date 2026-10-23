import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { UsageReport } from "../../src/report.js";
import { createEventReader } from "./events.js";
import { type Harness, harnessOf } from "./harnesses.js";
import { HOST_BATCH, hostContract, hostSignals } from "./host/contract.js";
import { sessionStem } from "./host/pi-sessions.js";
import { logKey } from "./keys.js";
import { usageReportSchema } from "./schema.js";

const FACTS_TTL_MS = 5 * 60_000;
const REPORT_TTL_MS = 60_000;
/** How long an unreachable host is left alone, and how often its failure is logged. */
const HOST_RETRY_MS = 60_000;
const HOST_TIMEOUT_MS = 25_000;
const SESSIONS_MAX = 32;
const CACHE_MAX = 1000;

/**
 * A report Burn read itself: "log" from a pi thread's session logs, "events"
 * from the usage bb records for other harnesses. `at` is when it last changed.
 */
export interface LogReport {
  report: UsageReport;
  at: number;
  source: "log" | "events";
}

export interface ReportSource {
  /** The latest report of each thread that has one: from its host or bb's events, else the last one kept. */
  reportsOf(threadIds: readonly string[]): Promise<Map<string, LogReport>>;
  /** Whether bb says the thread is working right now. */
  running(threadId: string): Promise<boolean>;
  /** How Burn reads the thread, or null when bb could not say. */
  harnessOf(threadId: string): Promise<Harness | null>;
  forget(threadId: string): Promise<void>;
}

/** What bb says about a thread: its provider, the machine that keeps its pi logs (null for none, or not pi) and its pi sessions. */
interface Facts {
  at: number;
  hostId: string | null;
  /** null when the lookup failed. */
  providerId: string | null;
  sessionIds: string[];
  /** The file names the host reports changes by. */
  stems: Set<string>;
}

const logSchema = z.object({ report: usageReportSchema, at: z.number() });

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
 * Every thread's report. A pi thread's is read by the Burn host entry from its
 * session logs on the machine that runs it, and kept until the host signals
 * that one of the thread's logs changed, or a minute passes. Any other thread's
 * comes from the usage bb records (events.ts). `onChange` names the threads to
 * look at again.
 */
export function createReportSource(bb: BbPluginApi, opts: { onChange(threadIds: string[]): void; now?: () => number }): ReportSource {
  const now = opts.now ?? Date.now;
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const events = createEventReader(bb, { onChange: opts.onChange, now });
  const facts = new Map<string, Facts>();
  const statuses = new Map<string, string>();
  // Thread events seen per thread, so a lookup that an event overtook does not undo it.
  const heard = new Map<string, number>();
  const reports = new Map<string, { got: LogReport | null; checkedAt: number }>();
  // Bumped by every change, so a read that raced the change is not kept as current.
  const versions = new Map<string, number>();
  const saved = new Map<string, number>();
  const failedAt = new Map<string, number>();

  async function lookUp(threadId: string): Promise<Facts> {
    const before = heard.get(threadId) ?? 0;
    const thread = await bb.sdk.threads.get({ threadId });
    if ((heard.get(threadId) ?? 0) === before) remember(statuses, threadId, thread.status);
    const reader = harnessOf(thread.providerId).reader;
    if ((reader !== "pi-log" && reader !== "opencode-db") || thread.environmentId === null) {
      return { at: now(), hostId: null, providerId: thread.providerId, sessionIds: [], stems: new Set() };
    }
    const { hostId } = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const rows = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"] });
    const identities = rows.flatMap((row) => {
      const id = (row.data as { providerThreadId?: unknown } | null)?.providerThreadId;
      return typeof id === "string" && id !== "" ? [id] : [];
    });
    // The thread id too, for a session named after the thread rather than an identity.
    const sessionIds = [...new Set([...identities, threadId])].slice(-SESSIONS_MAX);
    // Only pi's bridge names its session files after these ids.
    const stems = reader === "pi-log" ? new Set(sessionIds.map(sessionStem)) : new Set<string>();
    return { at: now(), hostId, providerId: thread.providerId, sessionIds, stems };
  }

  async function factsOf(threadId: string): Promise<Facts> {
    const held = facts.get(threadId);
    if (held && now() - held.at < FACTS_TTL_MS) return held;
    let found: Facts;
    try {
      found = await lookUp(threadId);
    } catch (err) {
      bb.log.warn(`looking up thread ${threadId} failed, so Burn reads no session log for it: ${message(err)}`);
      found = { at: now(), hostId: null, providerId: null, sessionIds: [], stems: new Set() };
    }
    remember(facts, threadId, found);
    return found;
  }

  function invalidate(threadId: string): void {
    reports.delete(threadId);
    remember(versions, threadId, (versions.get(threadId) ?? 0) + 1);
  }

  const fresh = (threadId: string): boolean => {
    const held = reports.get(threadId);
    return held !== undefined && now() - held.checkedAt < REPORT_TTL_MS;
  };
  const hostDown = (hostId: string): boolean => now() - (failedAt.get(hostId) ?? Number.NEGATIVE_INFINITY) < HOST_RETRY_MS;

  async function save(threadId: string, got: LogReport): Promise<void> {
    if (saved.get(threadId) === got.at) return;
    try {
      await bb.storage.kv.set(logKey(threadId), { report: got.report, at: got.at });
      remember(saved, threadId, got.at);
    } catch (err) {
      bb.log.warn(`saving the log report of ${threadId} failed: ${message(err)}`);
    }
  }

  async function lastKept(threadId: string): Promise<LogReport | null> {
    const raw = await bb.storage.kv.get<unknown>(logKey(threadId));
    if (raw === undefined) return null;
    const parsed = logSchema.safeParse(raw);
    if (parsed.success) return { ...parsed.data, source: "log" };
    await bb.storage.kv.delete(logKey(threadId));
    return null;
  }

  async function ask(hostId: string, harness: "pi" | "opencode", threadIds: string[], answers: Map<string, LogReport | null>): Promise<void> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (let start = 0; start < threadIds.length; start += HOST_BATCH) {
      const batch = threadIds.slice(start, start + HOST_BATCH);
      const seen = new Map(batch.map((id) => [id, versions.get(id) ?? 0]));
      const checkedAt = now();
      let answer: Awaited<ReturnType<typeof host.call<"reports">>>;
      try {
        answer = await host.call(
          "reports",
          { harness, timeZone, threads: batch.map((threadId) => ({ threadId, sessionIds: facts.get(threadId)?.sessionIds ?? [threadId] })) },
          { hostId, timeoutMs: HOST_TIMEOUT_MS },
        );
      } catch (err) {
        failedAt.set(hostId, now());
        const what = harness === "pi" ? "pi session logs" : "opencode's database";
        bb.log.warn(`reading ${what} on ${hostId} failed, so Burn shows the last figures it read there: ${message(err)}`);
        return;
      }
      failedAt.delete(hostId);
      for (const { threadId, report, at } of answer.reports) {
        const got: LogReport | null = report !== null && at !== null ? { report, at, source: "log" } : null;
        answers.set(threadId, got);
        if ((versions.get(threadId) ?? 0) === seen.get(threadId)) remember(reports, threadId, { got, checkedAt });
        if (got) await save(threadId, got);
      }
    }
  }

  host.experimental_onSignal("changed", ({ hostId, payload }) => {
    const changed = new Set(payload.sessionIds);
    const hit: string[] = [];
    for (const [threadId, f] of facts) {
      if (f.hostId === hostId && (payload.all || [...f.stems].some((stem) => changed.has(stem)))) hit.push(threadId);
    }
    for (const threadId of hit) invalidate(threadId);
    if (hit.length > 0) opts.onChange(hit);
  });

  host.experimental_onWorkerExit(({ hostId }) => {
    for (const [threadId, f] of facts) if (f.hostId === hostId) invalidate(threadId);
  });

  function hear(thread: { id: string; status: string }): void {
    remember(heard, thread.id, (heard.get(thread.id) ?? 0) + 1);
    remember(statuses, thread.id, thread.status);
  }

  /** bb stores a turn's usage just before the thread goes idle, so a status change reads the thread's events again. */
  function heardStatus(thread: { id: string; status: string; providerId: string }): void {
    hear(thread);
    const reader = harnessOf(thread.providerId).reader;
    if (reader === "events") events.invalidate(thread.id);
    // opencode records a call when it finishes, and Burn has no watch on its database.
    else if (reader === "opencode-db") invalidate(thread.id);
    opts.onChange([thread.id]);
  }

  bb.events.on("thread.active", ({ thread }) => {
    // A thread that just started may have a session bb had not named yet.
    if (harnessOf(thread.providerId).reader !== "events") facts.delete(thread.id);
    heardStatus(thread);
  });
  for (const name of ["thread.idle", "thread.failed"] as const) bb.events.on(name, ({ thread }) => heardStatus(thread));
  // Burn has no watch on opencode's database; bb records the thread's events, at most once a second, while opencode works.
  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (harnessOf(thread.providerId).reader !== "opencode-db") return;
    invalidate(thread.id);
    opts.onChange([thread.id]);
  });

  return {
    async reportsOf(threadIds) {
      const ids = [...new Set(threadIds)];
      const answers = new Map<string, LogReport | null>();
      const fromEvents = new Map<string, LogReport | null>();
      const eventReads: Promise<void>[] = [];
      const wanted = new Map<string, { hostId: string; harness: "pi" | "opencode"; threadIds: string[] }>();
      await Promise.all(
        ids.map(async (threadId) => {
          if (fresh(threadId)) return;
          const { hostId, providerId } = await factsOf(threadId);
          const reader = providerId === null ? null : harnessOf(providerId).reader;
          if (providerId !== null && reader === "events") {
            const read = events.reportOf(threadId, providerId).then((got) => void fromEvents.set(threadId, got && { ...got, source: "events" }));
            eventReads.push(read);
            return;
          }
          if (hostId === null || hostDown(hostId)) return;
          const harness = reader === "opencode-db" ? "opencode" : "pi";
          const key = `${hostId}:${harness}`;
          const group = wanted.get(key) ?? { hostId, harness, threadIds: [] };
          group.threadIds.push(threadId);
          wanted.set(key, group);
        }),
      );
      await Promise.all([...[...wanted.values()].map(({ hostId, harness, threadIds }) => ask(hostId, harness, threadIds, answers)), ...eventReads]);
      const out = new Map<string, LogReport>();
      for (const threadId of ids) {
        if (fromEvents.has(threadId)) {
          const got = fromEvents.get(threadId);
          if (got) out.set(threadId, got);
          continue;
        }
        const got = answers.has(threadId) ? answers.get(threadId) : fresh(threadId) ? reports.get(threadId)?.got : null;
        const best = got ?? (await lastKept(threadId));
        if (best) out.set(threadId, best);
      }
      return out;
    },
    async running(threadId) {
      await factsOf(threadId);
      return statuses.get(threadId) === "active";
    },
    harnessOf: async (threadId) => {
      const { providerId } = await factsOf(threadId);
      return providerId === null ? null : harnessOf(providerId);
    },
    async forget(threadId) {
      for (const map of [facts, statuses, heard, reports, versions, saved]) map.delete(threadId);
      await events.forget(threadId);
    },
  };
}
