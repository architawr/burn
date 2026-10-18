import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExperimentalHostWatchListener } from "@get-bb/plugin-sdk";
import { createFakePluginHost, type ExperimentalFakeHostRpcCall, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostEntry } from "../../extensions/bb/host/entry.js";
import { sessionFile } from "../../extensions/bb/host/pi-sessions.js";
import { createReportSource } from "../../extensions/bb/sources.js";
import { assistant, sampleReport, user } from "../helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const id = (n: number) => `thr_${String(n).padStart(8, "0")}`;
const A = "host_a";
const B = "host_b";
const costOf = (total: number) => sampleReport({ cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } });

type Thread = { host: string | null; provider?: string; status?: "active" | "idle" | "error"; sessions?: string[] };

/** A source over fake threads; each host answers with `costs[threadId]`, or throws when listed in `offline`. */
function setup(threads: Record<string, Thread>, opts: { offline?: string[] } = {}) {
  const costs: Record<string, number> = {};
  const calls: ExperimentalFakeHostRpcCall[] = [];
  const offline = new Set(opts.offline ?? []);
  let gate: Promise<void> | null = null;
  let getGate: Promise<void> | null = null;
  let now = 1_000_000;
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-burn",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const t = threads[threadId];
          if (getGate) await getGate;
          if (!t) throw new Error(`no thread ${threadId}`);
          return makeThreadResponse({ id: threadId, providerId: t.provider ?? "pi", environmentId: t.host ? `env_${t.host}` : null, status: t.status ?? "idle" });
        },
        events: {
          list: async ({ threadId }: { threadId: string }) =>
            (threads[threadId]?.sessions ?? [`pi_${threadId}`]).map((providerThreadId, seq) => ({ type: "thread/identity", threadId, seq, data: { providerThreadId } })),
        },
      },
      environments: { get: async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, hostId: environmentId.slice(4) }) },
    },
    experimental_callHostRpc: async (call) => {
      calls.push(call);
      if (gate) await gate;
      if (offline.has(call.hostId)) throw new Error(`host ${call.hostId} is not connected`);
      const input = call.input as { threads: { threadId: string }[] };
      return {
        dir: "/home/me/.bb/pi-bridge-sessions",
        reports: input.threads.map(({ threadId }) =>
          threadId in costs ? { threadId, report: costOf(costs[threadId]!), at: 1000 * costs[threadId]! } : { threadId, report: null, at: null },
        ),
      };
    },
  });
  const changed: string[][] = [];
  const source = createReportSource(bb, { onChange: (ids) => void changed.push(ids), now: () => now });
  const asked = (hostId?: string) =>
    calls
      .filter((c) => hostId === undefined || c.hostId === hostId)
      .map((c) => (c.input as { threads: { threadId: string }[] }).threads.map((t) => t.threadId));
  const cost = async (...ids: string[]) => {
    const got = await source.reportsOf(ids);
    return ids.map((i) => got.get(i)?.report.cost.total ?? null);
  };
  const hold = (): (() => void) => {
    let release = (): void => undefined;
    gate = new Promise((resolve) => {
      release = () => {
        gate = null;
        resolve();
      };
    });
    return release;
  };
  const holdLookups = (): (() => void) => {
    let release = (): void => undefined;
    getGate = new Promise((resolve) => {
      release = () => {
        getGate = null;
        resolve();
      };
    });
    return release;
  };
  return { bb, harness, source, costs, calls, asked, cost, changed, offline, hold, holdLookups, tick: (ms: number) => (now += ms) };
}

describe("createReportSource", () => {
  it("asks each thread's host for its report, in batches of 40, with its session ids and the server's zone", async () => {
    const threads: Record<string, Thread> = { [id(100)]: { host: B, sessions: ["pi_old", "pi_new"] } };
    for (let n = 0; n < 45; n++) threads[id(n)] = { host: A };
    const s = setup(threads);
    for (const t of Object.keys(threads)) s.costs[t] = 1;
    const got = await s.source.reportsOf(Object.keys(threads));
    expect(got.size).toBe(46);
    expect(s.asked(A).map((batch) => batch.length)).toEqual([40, 5]);
    expect(s.asked(B)).toEqual([[id(100)]]);
    const input = s.calls.find((c) => c.hostId === B)?.input;
    expect(input).toEqual({
      harness: "pi",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      threads: [{ threadId: id(100), sessionIds: ["pi_old", "pi_new", id(100)] }],
    });
  });

  it("keeps a report for a minute, then asks again", async () => {
    const s = setup({ [id(1)]: { host: A } });
    s.costs[id(1)] = 2;
    expect(await s.cost(id(1))).toEqual([2]);
    s.costs[id(1)] = 3;
    expect(await s.cost(id(1))).toEqual([2]);
    s.tick(60_000);
    expect(await s.cost(id(1))).toEqual([3]);
    expect(s.calls).toHaveLength(2);
  });

  it("rereads exactly the threads whose sessions changed, or every thread on the host for all", async () => {
    const s = setup({ [id(1)]: { host: A }, [id(2)]: { host: A, sessions: ["pi_shared"] }, [id(3)]: { host: B, sessions: ["pi_shared"] } });
    for (const t of [id(1), id(2), id(3)]) s.costs[t] = 1;
    await s.source.reportsOf([id(1), id(2), id(3)]);
    await s.harness.behavior.experimental_emitHostSignal(A, "changed", { sessionIds: ["pi_shared", "pi_unknown"], all: false });
    expect(s.changed).toEqual([[id(2)]]);
    s.costs[id(2)] = 5;
    expect(await s.cost(id(1), id(2), id(3))).toEqual([1, 5, 1]);
    expect(s.asked().at(-1)).toEqual([id(2)]);
    await s.harness.behavior.experimental_emitHostSignal(A, "changed", { sessionIds: [], all: true });
    expect(s.changed.at(-1)?.sort()).toEqual([id(1), id(2)]);
    await s.harness.behavior.experimental_emitHostSignal(B, "changed", { sessionIds: ["pi_nobody"], all: false });
    expect(s.changed).toHaveLength(2);
  });

  it("does not keep a read that a change overtook", async () => {
    const s = setup({ [id(1)]: { host: A } });
    s.costs[id(1)] = 1;
    await s.source.reportsOf([id(1)]);
    await s.harness.behavior.experimental_emitHostSignal(A, "changed", { sessionIds: [`pi_${id(1)}`], all: false });
    const release = s.hold();
    const racing = s.cost(id(1));
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    await s.harness.behavior.experimental_emitHostSignal(A, "changed", { sessionIds: [`pi_${id(1)}`], all: false });
    s.costs[id(1)] = 2;
    release();
    expect(await racing).toEqual([2]);
    await s.source.reportsOf([id(1)]);
    expect(s.calls).toHaveLength(3);
  });

  it("drops a host's reports when its worker exits", async () => {
    const s = setup({ [id(1)]: { host: A }, [id(2)]: { host: B } });
    s.costs[id(1)] = 1;
    s.costs[id(2)] = 1;
    await s.source.reportsOf([id(1), id(2)]);
    await s.harness.behavior.experimental_emitHostWorkerExit(A);
    await s.source.reportsOf([id(1), id(2)]);
    expect(s.asked()).toEqual([[id(1)], [id(2)], [id(1)]]);
  });

  it("serves the last report a host gave when that host is unreachable, and logs it once a minute", async () => {
    const s = setup({ [id(1)]: { host: A }, [id(2)]: { host: A } });
    s.costs[id(1)] = 4;
    const set = vi.spyOn(s.bb.storage.kv, "set");
    await s.source.reportsOf([id(1), id(2)]);
    expect(await s.bb.storage.kv.get(`log:${id(1)}`)).toMatchObject({ report: { cost: { total: 4 } }, at: 4000 });
    expect(await s.bb.storage.kv.get(`log:${id(2)}`)).toBeUndefined();
    s.tick(60_000);
    await s.source.reportsOf([id(1)]);
    expect(s.calls).toHaveLength(2);
    expect(set).toHaveBeenCalledTimes(1);
    s.tick(60_000);
    s.offline.add(A);
    expect(await s.cost(id(1), id(2))).toEqual([4, null]);
    s.tick(1000);
    await s.harness.behavior.experimental_emitHostSignal(A, "changed", { sessionIds: [], all: true });
    expect(await s.cost(id(1))).toEqual([4]);
    const warnings = s.harness.inspection.logEntries.filter((e) => e.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(`host ${A} is not connected`);
    s.offline.delete(A);
    s.costs[id(1)] = 6;
    s.tick(60_000);
    expect(await s.cost(id(1))).toEqual([6]);
  });

  it("asks no host for a thread of another provider, or one without a machine", async () => {
    const s = setup({ [id(1)]: { host: A, provider: "codex" }, [id(2)]: { host: null } });
    expect((await s.source.reportsOf([id(1), id(2), id(3)])).size).toBe(0);
    expect(s.calls).toEqual([]);
    expect(s.harness.inspection.logEntries.some((e) => e.level === "warn" && e.message.includes(id(3)))).toBe(true);
  });

  it("says a thread is running while bb says it is active, following thread events", async () => {
    const threads: Record<string, Thread> = { [id(1)]: { host: A, status: "active" }, [id(2)]: { host: A } };
    const s = setup(threads);
    expect(await s.source.running(id(1))).toBe(true);
    expect(await s.source.running(id(2))).toBe(false);
    threads[id(2)] = { host: A, status: "active" };
    await s.harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: id(2), providerId: "pi", status: "active" }) });
    expect(await s.source.running(id(2))).toBe(true);
    await s.harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: id(2), providerId: "pi", status: "idle" }), lastAssistantText: null });
    expect(await s.source.running(id(2))).toBe(false);
    await s.harness.behavior.emitThreadEvent("thread.failed", { thread: makeThreadResponse({ id: id(1), providerId: "pi", status: "error" }), error: "boom" });
    expect(await s.source.running(id(1))).toBe(false);
    await s.harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: id(3), providerId: "codex", status: "active" }) });
    expect(s.changed).toEqual([[id(2)], [id(2)], [id(1)]]);
  });

  it("keeps the status a thread event set while a lookup of that thread was under way", async () => {
    const s = setup({ [id(1)]: { host: A, status: "active" } });
    const release = s.holdLookups();
    const asking = s.source.running(id(1));
    await vi.waitFor(() => expect(s.harness.inspection.sdk.callsTo("threads.get")).toHaveLength(1));
    await s.harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: id(1), providerId: "pi", status: "idle" }), lastAssistantText: null });
    release();
    expect(await asking).toBe(false);
    expect(await s.source.running(id(1))).toBe(false);
  });

  it("looks a thread up again after it becomes active, and after it is forgotten", async () => {
    const threads: Record<string, Thread> = { [id(1)]: { host: A, sessions: [] } };
    const s = setup(threads);
    await s.source.reportsOf([id(1)]);
    threads[id(1)] = { host: A, sessions: ["pi_started"] };
    await s.harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: id(1), providerId: "pi", status: "active" }) });
    s.tick(60_000);
    await s.source.reportsOf([id(1)]);
    const sent = s.calls.map((c) => (c.input as { threads: { sessionIds: string[] }[] }).threads[0]?.sessionIds);
    expect(sent).toEqual([[id(1)], ["pi_started", id(1)]]);
    s.source.forget(id(1));
    await s.source.reportsOf([id(1)]);
    expect(s.harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(3);
  });
});

describe("createReportSource with the real host entry", () => {
  it("reads a pi session log on the host and updates as soon as the host signals a change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "burn-sources-"));
    dirs.push(dir);
    const thread = id(7);
    const file = sessionFile(dir, "pi_seven");
    const header = { type: "session", version: 3, id: "s", timestamp: "2026-10-18T12:00:00.000Z", cwd: "/tmp" };
    writeFileSync(file, [header, user(), assistant(1.5)].map((e) => `${JSON.stringify(e)}\n`).join(""));
    let listener: ExperimentalHostWatchListener | null = null;
    const host = experimental_createHostEntryHarness(createHostEntry({ dir }), {
      experimental_watch: (_options, l) => {
        listener = l;
        return { dispose: async () => undefined };
      },
    });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pi-burn",
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, providerId: "pi", environmentId: "env_1", status: "active" }),
          events: { list: async ({ threadId }: { threadId: string }) => [{ type: "thread/identity", threadId, seq: 1, data: { providerThreadId: "pi_seven" } }] },
        },
        environments: { get: async () => ({ id: "env_1", hostId: "host_1" }) },
      },
      experimental_callHostRpc: ({ method, input }) => host.experimental_call(method as "reports", input as never),
    });
    const changed: string[][] = [];
    const source = createReportSource(bb, { onChange: (ids) => void changed.push(ids) });
    expect((await source.reportsOf([thread])).get(thread)?.report.cost.total).toBeCloseTo(1.5);

    appendFileSync(file, `${JSON.stringify(assistant(2))}\n`);
    await listener!({ kind: "changed", changes: [{ path: file, type: "update" }] });
    for (const { signal, payload } of host.experimental_getSignals()) await harness.behavior.experimental_emitHostSignal("host_1", signal, payload);
    expect(changed).toEqual([[thread]]);
    expect((await source.reportsOf([thread])).get(thread)?.report.cost.total).toBeCloseTo(3.5);
    await host.experimental_dispose();
    await harness.lifecycle.dispose();
  });
});
