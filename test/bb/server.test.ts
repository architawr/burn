import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BurnAlert } from "../../extensions/bb/alerts.js";
import { sessionPath } from "../../extensions/bb/logs.js";
import plugin, { SETTINGS } from "../../extensions/bb/server.js";
import * as spendServer from "../../extensions/bb/spend/server.js";
import type { UsageReport } from "../../src/report.js";
import { buildReport, dayKey } from "../../src/report.js";
import { assistant, sampleReport, toolResult, user } from "../helpers.js";

const THREAD = "thr_aaaaaaaa";
const CHILD = "thr_cccccccc";
const GRANDCHILD = "thr_dddddddd";
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

type Options = {
  settings?: Record<string, number | boolean | string>;
  descendants?: Record<string, string[]>;
  titles?: Record<string, string>;
  /** Session log entries per thread, written where bb's pi bridge keeps them. */
  logs?: Record<string, unknown[]>;
  /** What `threads.list` returns. */
  listed?: { id: string; providerId: string; updatedAt: number; deletedAt: number | null }[];
};

const LOG_MTIME = 1_700_000_000_000;

function writeLogs(logs: Record<string, unknown[]>): string {
  const dataDir = mkdtempSync(join(tmpdir(), "burn-server-"));
  disposers.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "pi-bridge-sessions"));
  for (const [threadId, entries] of Object.entries(logs)) {
    const path = sessionPath(dataDir, `pi_${threadId}`);
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"));
    utimesSync(path, LOG_MTIME / 1000, LOG_MTIME / 1000);
  }
  return dataDir;
}

async function setup(opts: Options = {}) {
  const logs = opts.logs ?? {};
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-burn",
    settings: opts.settings,
    dataDir: writeLogs(logs),
    sdk: {
      threads: {
        list: async () => opts.listed ?? [],
        events: {
          list: async ({ threadId }: { threadId: string }) =>
            threadId in logs ? [{ type: "thread/identity", threadId, seq: 1, data: { providerThreadId: `pi_${threadId}` } }] : [],
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, title: opts.titles?.[threadId] ?? null }),
        experimental_listDescendants: async ({ threadIds }: { threadIds: readonly string[] }) => ({
          threads: threadIds.map((threadId) => ({ threadId, descendantIds: opts.descendants?.[threadId] ?? [] })),
        }),
      },
    },
  });
  await plugin(bb);
  disposers.push(() => harness.lifecycle.dispose());
  const post = (body: unknown) =>
    harness.behavior.fetchHttp("POST", "/usage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const rpc = <T,>(method: string, input: unknown) => harness.behavior.callRpc(method, input) as Promise<T>;
  const usage = (threadId = THREAD) => rpc<Record<string, any>>("usage", { threadId });
  const signals = () => harness.inspection.realtimeSignals.filter((s) => s.channel === "usage");
  const alerts = () => harness.inspection.realtimeSignals.filter((s) => s.channel === "alert").map((s) => s.payload as BurnAlert);
  return { bb, harness, post, rpc, usage, signals, alerts };
}

const envelope = (sentAt: number, over: Partial<UsageReport> = {}, threadId = THREAD) => ({ threadId, sentAt, report: sampleReport(over) });
const costOf = (total: number): Partial<UsageReport> => ({ cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } });
const QUIET = { budget: null, stopAtBudget: false, notifyExpensiveTurn: false };

describe("settings", () => {
  it("declares every setting in order, with quiet defaults", async () => {
    const s = await setup();
    const declared = s.harness.inspection.registrations.settingsDescriptors;
    expect(Object.keys(declared)).toEqual([
      "chip",
      "chipShows",
      "threadBudget",
      "dailyBudget",
      "budgetAlerts",
      "stopAtBudget",
      "flagOverBudget",
      "notifyExpensiveTurn",
    ]);
    expect(declared.chip).toMatchObject({ type: "boolean", label: "Cost chip", default: true });
    expect(declared.chipShows).toMatchObject({ type: "select", options: ["delta", "cost"], default: "delta" });
    expect(declared.threadBudget).toMatchObject({ type: "number", label: "Thread budget" });
    expect("default" in declared.threadBudget).toBe(false);
    expect("default" in declared.dailyBudget).toBe(false);
    expect(declared.budgetAlerts).toMatchObject({ default: true });
    expect(declared.flagOverBudget).toMatchObject({ default: true });
    expect(declared.notifyExpensiveTurn).toMatchObject({ default: false });
  });

  it("never stops a thread by default, and says so", async () => {
    const s = await setup();
    const stop = s.harness.inspection.registrations.settingsDescriptors.stopAtBudget;
    expect(stop).toMatchObject({ type: "boolean", label: "Stop a thread at its budget", default: false });
    expect(stop?.description).toMatch(/^Off by default/);
    expect(stop?.description).toContain("only the pi run whose cost crosses");
    expect(stop?.description).toContain("Send another prompt to continue");
    expect(SETTINGS.notifyExpensiveTurn.description).toContain("at least 3 times the thread's median turn and at least $0.50");
  });

  it("rejects a budget of zero or less", async () => {
    const s = await setup();
    await expect(s.harness.behavior.setSettings({ threadBudget: -1 })).rejects.toThrow(/above zero/);
    await s.harness.behavior.setSettings({ threadBudget: 12.5 });
    expect((await s.usage()).policy.budget).toBe(12.5);
  });
});

describe("POST /usage", () => {
  it("stores a report, publishes a signal, serves it over rpc and replies with the policy", async () => {
    const s = await setup();
    const report = buildReport([user(), assistant(1.25)], { tokens: 1, window: 2, percent: 50 });
    const res = await s.post({ threadId: THREAD, sentAt: 1, report });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, policy: QUIET });
    const got = await s.usage();
    expect(got.report).toEqual(report);
    expect(typeof got.reportedAt).toBe("number");
    expect(s.signals()).toEqual([{ channel: "usage", payload: { threadId: THREAD } }]);
  });

  it("hands pi bb's budget: the thread's own, else the setting, and the stop setting as set", async () => {
    const s = await setup({ settings: { threadBudget: 10, stopAtBudget: true } });
    expect(await (await s.post(envelope(1))).json()).toEqual({ ok: true, policy: { budget: 10, stopAtBudget: true, notifyExpensiveTurn: false } });
    await s.rpc("setBudget", { threadId: THREAD, budget: 4 });
    expect((await (await s.post(envelope(2))).json()).policy.budget).toBe(4);
    await s.rpc("setBudget", { threadId: THREAD, budget: null });
    expect((await (await s.post(envelope(3))).json()).policy.budget).toBeNull();
    await s.rpc("setBudget", { threadId: THREAD, budget: "default" });
    expect((await (await s.post(envelope(4))).json()).policy.budget).toBe(10);
  });

  it("rejects an oversize body, bad JSON and an invalid report", async () => {
    const s = await setup();
    expect((await s.post("x".repeat(128 * 1024 + 1))).status).toBe(413);
    expect((await s.post("{nope")).status).toBe(400);
    expect((await s.post({ threadId: THREAD, sentAt: 1, report: { version: 1 } })).status).toBe(400);
    expect(s.signals()).toEqual([]);
  });

  it("ignores a report older than the stored one but still answers with the policy", async () => {
    const s = await setup();
    await s.post(envelope(10, { calls: 5 }));
    const stale = await s.post(envelope(5, { calls: 1 }));
    expect(await stale.json()).toEqual({ ok: true, policy: QUIET });
    expect((await s.usage()).report).toMatchObject({ calls: 5 });
    expect(s.signals()).toHaveLength(1);
  });

  it("keeps reports and budgets across a plugin reload", async () => {
    const s = await setup();
    await s.post(envelope(1));
    await s.rpc("setBudget", { threadId: THREAD, budget: 7.5 });
    const next = await s.harness.lifecycle.reload(plugin);
    disposers.push(() => next.harness.lifecycle.dispose());
    const got = (await next.harness.behavior.callRpc("usage", { threadId: THREAD })) as Record<string, any>;
    expect(got.report).toMatchObject({ calls: 23 });
    expect(got.budget).toEqual({ amount: 7.5, source: "thread" });
  });

  it("drops stored rows that no longer match the schema", async () => {
    const s = await setup();
    await s.bb.storage.kv.set(`report:${THREAD}`, { report: { version: 0 }, sentAt: 1, at: 1 });
    await s.bb.storage.kv.set(`budget:${THREAD}`, { budget: "lots" });
    expect(await s.usage()).toMatchObject({ report: null, reportedAt: null, budget: null });
    expect(await s.bb.storage.kv.get(`report:${THREAD}`)).toBeUndefined();
    expect(await s.bb.storage.kv.get(`budget:${THREAD}`)).toBeUndefined();
  });

  it("gives pi the report address", async () => {
    const s = await setup();
    const entries = await s.harness.behavior.resolveProviderEnv("pi", { threadId: THREAD, projectId: "proj_1", hostId: "host_1" });
    expect(entries.map((e) => [e.name, e.value])).toEqual([["BURN_BB_URL", { serverPath: "/api/v1/plugins/pi-burn/http/usage" }]]);
  });

  it("forgets a deleted thread's report and budget", async () => {
    const s = await setup();
    await s.post(envelope(1));
    await s.rpc("setBudget", { threadId: THREAD, budget: 3 });
    await s.harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: THREAD }) });
    expect(await s.usage()).toMatchObject({ report: null, reportedAt: null, budget: null });
    expect(await s.bb.storage.kv.get(`report:${THREAD}`)).toBeUndefined();
    expect(await s.bb.storage.kv.get(`budget:${THREAD}`)).toBeUndefined();
  });

  it("evicts the least recently updated thread from memory above 500 threads", async () => {
    const s = await setup();
    const id = (n: number) => `thr_${String(n).padStart(8, "0")}`;
    for (let n = 0; n < 501; n++) await s.post(envelope(1, {}, id(n)));
    // The evicted thread still reads back from storage.
    expect((await s.usage(id(0))).report).not.toBeNull();
  });
});

describe("budgets", () => {
  it("names where the budget comes from: the thread, the setting, pi, or nowhere", async () => {
    const none = await setup();
    await none.post(envelope(1));
    expect((await none.usage()).budget).toBeNull();

    const pi = await setup();
    await pi.post(envelope(1, { budget: 6 }));
    expect((await pi.usage()).budget).toEqual({ amount: 6, source: "pi" });

    const setting = await setup({ settings: { threadBudget: 10 } });
    await setting.post(envelope(1, { budget: 6 }));
    expect((await setting.usage()).budget).toEqual({ amount: 10, source: "setting" });
    await setting.rpc("setBudget", { threadId: THREAD, budget: 2.5 });
    expect((await setting.usage()).budget).toEqual({ amount: 2.5, source: "thread" });
    // No budget of its own means bb hands pi none, so pi's own applies, as pi applies it.
    await setting.rpc("setBudget", { threadId: THREAD, budget: null });
    expect((await setting.usage()).budget).toEqual({ amount: 6, source: "pi" });
  });

  it("stores a thread's budget in KV, deletes it for default, and signals the change", async () => {
    const s = await setup({ settings: { threadBudget: 10 } });
    const set = await s.rpc<Record<string, any>>("setBudget", { threadId: THREAD, budget: 5 });
    expect(set).toEqual({ budget: { amount: 5, source: "thread" }, policy: { budget: 5, stopAtBudget: false, notifyExpensiveTurn: false } });
    expect(await s.bb.storage.kv.get(`budget:${THREAD}`)).toEqual({ budget: 5 });
    await s.rpc("setBudget", { threadId: THREAD, budget: null });
    expect(await s.bb.storage.kv.get(`budget:${THREAD}`)).toEqual({ budget: null });
    const reset = await s.rpc<Record<string, any>>("setBudget", { threadId: THREAD, budget: "default" });
    expect(reset.budget).toEqual({ amount: 10, source: "setting" });
    expect(await s.bb.storage.kv.get(`budget:${THREAD}`)).toBeUndefined();
    expect(s.signals()).toHaveLength(3);
    await expect(s.rpc("setBudget", { threadId: THREAD, budget: -2 })).rejects.toThrow();
  });
});

describe("alerts", () => {
  // Alerts go out after the reply; a few macrotasks let a quiet case prove it stayed quiet.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("warns once at 80% and once at 100% of the budget, with the thread's title", async () => {
    const s = await setup({ settings: { threadBudget: 10 }, titles: { [THREAD]: "Refactor the parser" } });
    await s.post(envelope(1, costOf(5)));
    await s.post(envelope(2, costOf(8.1)));
    await s.post(envelope(3, costOf(8.5)));
    await s.post(envelope(4, costOf(10.2)));
    await s.post(envelope(5, costOf(12)));
    await vi.waitFor(() => expect(s.alerts()).toHaveLength(2));
    const [near, over] = s.alerts();
    expect(near).toMatchObject({ kind: "near", threadId: THREAD, title: "“Refactor the parser” is near its budget", body: "$8.10 of the $10 thread budget (81%)." });
    expect(over).toMatchObject({ kind: "over", title: "“Refactor the parser” is over its budget" });
    expect(near?.id).not.toBe(over?.id);
  });

  it("stays quiet on a thread's first report, and with budget alerts off", async () => {
    const first = await setup({ settings: { threadBudget: 10 } });
    await first.post(envelope(1, costOf(12)));
    const off = await setup({ settings: { threadBudget: 10, budgetAlerts: false } });
    await off.post(envelope(1, costOf(5)));
    await off.post(envelope(2, costOf(12)));
    await settle();
    expect(first.alerts()).toEqual([]);
    expect(off.alerts()).toEqual([]);
  });

  it("says when pi stopped a run at the budget, once per stop", async () => {
    const s = await setup({ settings: { threadBudget: 10, budgetAlerts: false }, titles: { [THREAD]: "Big job" } });
    await s.post(envelope(1, costOf(9)));
    await s.post(envelope(2, { ...costOf(10.1), stoppedAt: 1000 }));
    await s.post(envelope(3, { ...costOf(10.1), stoppedAt: 1000 }));
    await vi.waitFor(() => expect(s.alerts()).toHaveLength(1));
    expect(s.alerts()[0]).toMatchObject({ id: `stopped:${THREAD}:1000`, kind: "stopped", title: "Burn stopped “Big job” at its $10 budget" });
  });

  it("nudges after an unusually expensive turn only when that setting is on", async () => {
    const turns = sampleReport().turns;
    const cheap = turns.map((t) => ({ ...t, cost: 0.2, callCosts: [0.2] }));
    const running: Partial<UsageReport> = { turns: [...cheap, { ...turns[3]!, n: 5, cost: 0.1 }], turnCount: 5, running: true };
    const done: Partial<UsageReport> = { turns: [...cheap, { ...turns[3]!, n: 5, cost: 1.5 }], turnCount: 5, running: false };

    const quiet = await setup();
    await quiet.post(envelope(1, running));
    await quiet.post(envelope(2, done));
    await settle();
    const on = await setup({ settings: { notifyExpensiveTurn: true } });
    await on.post(envelope(1, running));
    await on.post(envelope(2, done));
    await on.post(envelope(3, done));
    await vi.waitFor(() => expect(on.alerts()).toHaveLength(1));
    expect(on.alerts()[0]).toMatchObject({ id: `expensive:${THREAD}:5`, kind: "expensive", body: "Turn 5 cost $1.50, 7.5 times the thread's median turn." });
    expect(quiet.alerts()).toEqual([]);
  });

  it("publishes the daily budget alert the Spend module returns", async () => {
    const daily: BurnAlert = { id: "daily:2026-10-18", kind: "daily", threadId: null, title: "Daily budget reached", body: "…", at: 1 };
    const check = vi.spyOn(spendServer, "checkDailyBudget").mockResolvedValueOnce(daily);
    const s = await setup({ settings: { dailyBudget: 50 } });
    await s.post(envelope(1));
    await vi.waitFor(() => expect(s.alerts()).toEqual([daily]));
    expect(await check.mock.calls[0]?.[0].dailyBudget()).toBe(50);
  });
});

describe("costs, overBudget and family", () => {
  it("adds up a thread and its reported descendants", async () => {
    const s = await setup({ descendants: { [THREAD]: [CHILD, GRANDCHILD, "thr_eeeeeeee"] }, titles: { [CHILD]: "Write chip tests" } });
    await s.post(envelope(1, { ...costOf(4.82), calls: 23 }));
    await s.post(envelope(1, { ...costOf(1.1), calls: 14, running: true }, CHILD));
    await s.post(envelope(1, { ...costOf(0.72), calls: 9 }, GRANDCHILD));
    const { family, title } = await s.usage();
    expect(title).toBeNull();
    expect(family.total).toBeCloseTo(6.64);
    expect(family.calls).toBe(46);
    expect(family.children).toEqual([
      { threadId: CHILD, title: "Write chip tests", cost: 1.1, calls: 14, running: true, model: "p/claude-opus" },
      { threadId: GRANDCHILD, title: "Untitled thread", cost: 0.72, calls: 9, running: false, model: "p/claude-opus" },
    ]);
  });

  it("answers costs per thread with its family total, budget and state", async () => {
    const s = await setup({ settings: { threadBudget: 10 }, descendants: { [THREAD]: [CHILD] } });
    await s.post(envelope(1, costOf(4.82)));
    await s.post(envelope(1, costOf(1.82), CHILD));
    await s.rpc("setBudget", { threadId: CHILD, budget: 2 });
    const { threads } = await s.rpc<{ threads: Record<string, unknown>[] }>("costs", { threadIds: [THREAD, CHILD, "thr_ffffffff"] });
    expect(threads).toEqual([
      { threadId: THREAD, cost: 4.82, label: "$4.82", familyCost: expect.closeTo(6.64), budget: { amount: 10, source: "setting" }, state: "ok" },
      { threadId: CHILD, cost: 1.82, label: "$1.82", familyCost: null, budget: { amount: 2, source: "thread" }, state: "near" },
      { threadId: "thr_ffffffff", cost: null, label: null, familyCost: null, budget: { amount: 10, source: "setting" }, state: "ok" },
    ]);
    await expect(s.rpc("costs", { threadIds: [] })).rejects.toThrow();
  });

  it("lists every stored thread over its budget", async () => {
    const s = await setup({ settings: { threadBudget: 10 } });
    await s.post(envelope(1, costOf(12.4)));
    await s.post(envelope(1, costOf(3), CHILD));
    await s.post(envelope(1, costOf(30), GRANDCHILD));
    await s.rpc("setBudget", { threadId: GRANDCHILD, budget: null });
    expect(await s.rpc("overBudget", {})).toEqual({ threads: [{ threadId: THREAD, cost: 12.4, budget: 10 }] });
  });

  it("reads the session log of a thread or child that never reported", async () => {
    const s = await setup({
      descendants: { [THREAD]: [CHILD, GRANDCHILD] },
      titles: { [GRANDCHILD]: "Kevin" },
      logs: { [THREAD]: [user("hi"), assistant(1.5)], [GRANDCHILD]: [user("build it"), assistant(2), toolResult(0.5), assistant(3)] },
    });
    await s.post(envelope(1, { ...costOf(1.1), calls: 14 }, CHILD));
    const got = await s.usage();
    expect(got).toMatchObject({ source: "log", reportedAt: LOG_MTIME });
    expect(got.report.cost.total).toBeCloseTo(1.5);
    expect(got.family.total).toBeCloseTo(1.5 + 1.1 + 5.5);
    expect(got.family.children.map((c: { title: string }) => c.title)).toEqual(["Kevin", "Untitled thread"]);
    const { threads } = await s.rpc<{ threads: { familyCost: number }[] }>("costs", { threadIds: [THREAD] });
    expect(threads[0]?.familyCost).toBeCloseTo(8.1);
    expect((await s.usage(CHILD)).source).toBe("pi");
  });

  it("counts pi threads that never reported on the Burn page, and skips other providers and deleted threads", async () => {
    const today = (entry: { timestamp: string }) => ({ ...entry, timestamp: new Date().toISOString() });
    const s = await setup({
      logs: { [CHILD]: [today(user("hi")), today(assistant(3))], [GRANDCHILD]: [today(user()), today(assistant(5))] },
      listed: [
        { id: CHILD, providerId: "pi", updatedAt: Date.now(), deletedAt: null },
        { id: GRANDCHILD, providerId: "pi", updatedAt: Date.now(), deletedAt: Date.now() },
        { id: "thr_eeeeeeee", providerId: "codex", updatedAt: Date.now(), deletedAt: null },
      ],
    });
    s.harness.sdk.stub("projects.list", async () => []);
    await s.post(envelope(1, { ...costOf(2), days: [{ day: dayKey(Date.now()), cost: 2, calls: 1, models: [] }] }));
    const spend = await s.rpc<{ total: number; threadCount: number }>("spend", { range: "today", projectId: null });
    expect(spend.threadCount).toBe(2);
    expect(spend.total).toBeCloseTo(5);
  });

  it("prefers the log over a report from Burn 0.1, which has no prompts or days", async () => {
    const s = await setup({ logs: { [THREAD]: [user("hi"), assistant(2)] } });
    const { turnCount, turns, days, running, budget, stoppedAt, ...rest } = sampleReport(costOf(9));
    await s.post({ threadId: THREAD, sentAt: 1, report: { ...rest, version: 1, series: [] } });
    const got = await s.usage();
    expect(got.source).toBe("log");
    expect(got.report.cost.total).toBeCloseTo(2);
  });

  it("still answers when bb cannot list child threads", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "pi-burn" });
    await plugin(bb);
    disposers.push(() => harness.lifecycle.dispose());
    const got = (await harness.behavior.callRpc("usage", { threadId: THREAD })) as Record<string, any>;
    expect(got).toMatchObject({ report: null, title: null, family: { total: 0, calls: 0, children: [] }, policy: QUIET });
    expect(harness.inspection.logEntries.some((e) => e.level === "warn")).toBe(true);
  });
});
