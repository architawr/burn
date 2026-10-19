import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { reportKey } from "../../extensions/bb/keys.js";
import { dayDate, localDays } from "../../extensions/bb/spend/days.js";
import { checkDailyBudget, createSpendHandlers, type SpendDeps } from "../../extensions/bb/spend/server.js";
import { dayKey, type DayRow, type UsageReport } from "../../src/report.js";
import { sampleReport } from "../helpers.js";

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const DAY_MS = 86_400_000;
const ago = (n: number): string => dayKey(new Date(2026, 9, 18 - n, 12).getTime());
const utcAgo = (n: number): string => localDays(NOW, 1, n, "utc")[0] as string;

interface Seed {
  title?: string | null;
  titleFallback?: string | null;
  projectId?: string;
  children?: number;
  deletedAt?: number | null;
}

const PROJECTS = [
  { id: "proj_a", name: "alpha" },
  { id: "proj_b", name: "beta" },
  { id: "proj_c", name: "gamma" },
];

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const day = (daysAgo: number, cost: number, models: Record<string, number> = { "p/claude-opus": cost }, calls = 2): DayRow => ({
  day: ago(daysAgo),
  cost,
  calls,
  models: Object.entries(models).map(([key, c]) => ({ key, cost: c })),
});

const reportWith = (days: DayRow[], over: Partial<UsageReport> = {}): UsageReport => {
  const total = days.reduce((sum, d) => sum + d.cost, 0);
  return sampleReport({
    days,
    cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
    calls: days.reduce((sum, d) => sum + d.calls, 0),
    ...over,
  });
};

async function setup(opts: {
  reports: Record<string, unknown>;
  threads: Record<string, Seed>;
  budgets?: Record<string, number>;
  daily?: number | null;
}) {
  const { threads } = opts;
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-burn",
    sdk: {
      threads: {
        experimental_listDescendants: ({ threadIds }) => ({
          threads: threadIds
            .filter((id) => threads[id] !== undefined && !threads[id]?.deletedAt)
            .map((id) => ({ threadId: id, descendantIds: Array.from({ length: threads[id]?.children ?? 0 }, (_, i) => `${id}_c${i}`) })),
        }),
        get: ({ threadId }) => {
          const seed = threads[threadId];
          if (!seed) throw new Error(`Thread not found: ${threadId}`);
          return makeThreadResponse({
            id: threadId,
            title: seed.title === undefined ? `Title of ${threadId}` : seed.title,
            titleFallback: seed.titleFallback ?? null,
            projectId: seed.projectId ?? "proj_a",
            deletedAt: seed.deletedAt ?? null,
          });
        },
      },
      projects: { list: () => PROJECTS },
    },
  });
  disposers.push(() => harness.lifecycle.dispose());
  for (const [id, value] of Object.entries(opts.reports)) {
    await bb.storage.kv.set(reportKey(id), value instanceof Object && "version" in value ? { report: value, sentAt: 1, at: 1 } : value);
  }
  let now = NOW;
  const makeDeps = (): SpendDeps => ({
    bb,
    budgetOf: async (threadId) => opts.budgets?.[threadId] ?? null,
    dailyBudget: async () => opts.daily ?? null,
    now: () => now,
  });
  const deps = makeDeps();
  const { spend } = createSpendHandlers(deps);
  return {
    bb,
    harness,
    deps,
    makeDeps,
    spend,
    setNow: (next: number) => {
      now = next;
    },
    sdkCalls: (path: string) => harness.sdk.callsTo(path),
  };
}

describe("spend", () => {
  it("sums the range and the same length before it, every day zero-filled and oldest first", async () => {
    const s = await setup({
      reports: { thr_aaaaaa01: reportWith([day(14, 9), day(13, 1), day(7, 4), day(6, 0.5), day(3, 1), day(0, 2)]) },
      threads: { thr_aaaaaa01: {} },
    });
    const week = await s.spend({ range: "7d", projectId: null });
    expect(week.total).toBeCloseTo(3.5);
    expect(week.previousTotal).toBeCloseTo(5);
    expect(week.days.map((d) => d.day)).toEqual([6, 5, 4, 3, 2, 1, 0].map(ago));
    expect(week.days.map((d) => d.cost)).toEqual([0.5, 0, 0, 1, 0, 0, 2]);
    expect(week.days[1]?.models).toEqual([]);
    expect(week.days[6]?.models).toEqual([{ key: "p/claude-opus", cost: 2 }]);

    const today = await s.spend({ range: "today", projectId: null });
    expect(today.days.map((d) => d.day)).toEqual([ago(0)]);
    expect(today.total).toBeCloseTo(2);
    expect(today.previousTotal).toBe(0);

    const month = await s.spend({ range: "30d", projectId: null });
    expect(month.days).toHaveLength(30);
    expect(month.days[0]?.day).toBe(ago(29));
    expect(month.total).toBeCloseTo(17.5);
    expect(month.range).toBe("30d");
  });

  it("sums each day's models across threads and folds beyond four into Other", async () => {
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 10, { "p/m1": 6, "p/m2": 4 }), day(1, 3, { "p/m4": 3 })]),
        thr_aaaaaa02: reportWith([day(0, 8, { "p/m1": 1, "p/m3": 4, "p/m5": 2, "p/m6": 1 })]),
      },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa02: {} },
    });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.models).toEqual([
      { key: "p/m1", cost: 7 },
      { key: "p/m2", cost: 4 },
      { key: "p/m3", cost: 4 },
      { key: "Other", cost: 6 },
    ]);
    expect(out.days[6]).toEqual({
      day: ago(0),
      cost: 18,
      models: [
        { key: "p/m1", cost: 7 },
        { key: "p/m2", cost: 4 },
        { key: "p/m3", cost: 4 },
        { key: "Other", cost: 3 },
      ],
    });
    expect(out.days[5]?.models).toEqual([{ key: "Other", cost: 3 }]);
  });

  it("filters everything to one project, and offers every project with a report", async () => {
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 5), day(8, 1)]),
        thr_aaaaaa02: reportWith([day(1, 3), day(9, 2)]),
        thr_aaaaaa03: reportWith([day(2, 1)]),
        thr_aaaaaa04: reportWith([day(40, 7)]),
      },
      threads: {
        thr_aaaaaa01: { projectId: "proj_b" },
        thr_aaaaaa02: { projectId: "proj_a" },
        thr_aaaaaa03: { projectId: "proj_a" },
        thr_aaaaaa04: { projectId: "proj_c" },
      },
    });
    const all = await s.spend({ range: "7d", projectId: null });
    expect(all.projects).toEqual([
      { projectId: "proj_b", name: "beta", cost: 5 },
      { projectId: "proj_a", name: "alpha", cost: 4 },
    ]);
    expect(all.projectOptions).toEqual([
      { projectId: "proj_a", name: "alpha" },
      { projectId: "proj_b", name: "beta" },
      { projectId: "proj_c", name: "gamma" },
    ]);

    const alpha = await s.spend({ range: "7d", projectId: "proj_a" });
    expect(alpha.total).toBe(4);
    expect(alpha.previousTotal).toBe(2);
    expect(alpha.threadCount).toBe(2);
    expect(alpha.threads.map((t) => t.threadId)).toEqual(["thr_aaaaaa02", "thr_aaaaaa03"]);
    expect(alpha.projects).toEqual([{ projectId: "proj_a", name: "alpha", cost: 4 }]);
    expect(alpha.days.map((d) => d.cost)).toEqual([0, 0, 0, 0, 1, 3, 0]);
    expect(alpha.projectOptions).toEqual(all.projectOptions);
    expect(alpha.reportedThreads).toBe(4);
  });

  it("lists the ten costliest threads in the range with what the table shows", async () => {
    const reports: Record<string, UsageReport> = {};
    const threads: Record<string, Seed> = {};
    for (let i = 1; i <= 12; i++) {
      const id = `thr_bbbbbb${String(i).padStart(2, "0")}`;
      reports[id] = reportWith([day(0, i, { "p/claude-haiku": i / 4, "p/claude-opus": (3 * i) / 4 }, i), day(20, 100)], {
        running: i === 12,
      });
      threads[id] = { projectId: "proj_b", children: i === 12 ? 3 : 0 };
    }
    threads.thr_bbbbbb11 = { title: null, titleFallback: "Fix the flaky test", projectId: "proj_b" };
    threads.thr_bbbbbb10 = { title: null, projectId: "proj_b" };
    const s = await setup({ reports, threads });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.threadCount).toBe(12);
    expect(out.threads.map((t) => t.rangeCost)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(out.threads[0]).toEqual({
      threadId: "thr_bbbbbb12",
      title: "Title of thr_bbbbbb12",
      projectName: "beta",
      model: "claude-opus",
      childCount: 3,
      calls: 12,
      rangeCost: 12,
      total: 112,
      budget: null,
      running: true,
      estimated: false,
    });
    expect(out.threads[1]?.title).toBe("Fix the flaky test");
    expect(out.threads[2]?.title).toBe("Untitled thread");
    expect(out.threads[2]?.running).toBe(false);
  });

  it("marks each estimated thread, and says when the spend it counts includes one", async () => {
    const threads: Record<string, Seed> = { thr_aaaaaa01: {}, thr_aaaaaa02: {}, thr_aaaaaa03: {} };
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 2)], { estimated: true }),
        thr_aaaaaa02: reportWith([day(0, 1)]),
        thr_aaaaaa03: reportWith([day(20, 5)], { estimated: true }),
      },
      threads,
    });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.estimated).toBe(true);
    expect(out.threads.map((t) => [t.threadId, t.estimated])).toEqual([
      ["thr_aaaaaa01", true],
      ["thr_aaaaaa02", false],
    ]);
    const exact = await setup({ reports: { thr_aaaaaa02: reportWith([day(0, 1)]), thr_aaaaaa03: reportWith([day(20, 5)], { estimated: true }) }, threads });
    expect((await exact.spend({ range: "7d", projectId: null })).estimated).toBe(false);
  });

  it("sums each thread's UTC days over UTC calendar days when asked, and says which", async () => {
    const utc = (n: number, cost: number): DayRow => ({ day: utcAgo(n), cost, calls: 1, models: [{ key: "p/claude-opus", cost }] });
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 2)], { utcDays: [utc(1, 1), utc(0, 5)] }),
        // Burn 0.2 sent no UTC days; its local days stand in for them.
        thr_aaaaaa02: reportWith([day(1, 3)], { utcDays: [] }),
      },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa02: {} },
    });
    const today = await s.spend({ range: "today", projectId: null, tz: "utc" });
    expect(today).toMatchObject({ tz: "utc", total: 5 });
    expect(today.days.map((d) => d.day)).toEqual([utcAgo(0)]);
    const week = await s.spend({ range: "7d", projectId: null, tz: "utc" });
    expect(week.days.map((d) => d.day)).toEqual(localDays(NOW, 7, 0, "utc"));
    expect(week.total).toBeCloseTo(9);
    expect(await s.spend({ range: "today", projectId: null })).toMatchObject({ tz: "local", total: 2 });
  });

  it("counts threads over their effective budget", async () => {
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 4), day(30, 8)]),
        thr_aaaaaa02: reportWith([day(0, 2)]),
        thr_aaaaaa03: reportWith([day(0, 1)]),
        thr_aaaaaa04: reportWith([day(20, 50)]),
      },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa02: {}, thr_aaaaaa03: {}, thr_aaaaaa04: {} },
      budgets: { thr_aaaaaa01: 10, thr_aaaaaa02: 2, thr_aaaaaa03: 5, thr_aaaaaa04: 1 },
    });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.overBudgetCount).toBe(2);
    expect(out.threads.map((t) => [t.threadId, t.budget])).toEqual([
      ["thr_aaaaaa01", 10],
      ["thr_aaaaaa02", 2],
      ["thr_aaaaaa03", 5],
    ]);
  });

  it("reports the median thread, cost per call and cache hit rate across the threads in range", async () => {
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 1, undefined, 1)], { tokens: { input: 100, output: 9, cacheRead: 300, cacheWrite: 0, reasoning: 0 } }),
        thr_aaaaaa02: reportWith([day(1, 3, undefined, 3)], { tokens: { input: 100, output: 9, cacheRead: 100, cacheWrite: 400, reasoning: 0 } }),
        thr_aaaaaa03: reportWith([day(2, 8, undefined, 4)], { tokens: { input: 0, output: 9, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }),
        thr_aaaaaa04: reportWith([day(12, 90)], { tokens: { input: 9000, output: 9, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }),
      },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa02: {}, thr_aaaaaa03: {}, thr_aaaaaa04: {} },
      daily: 50,
    });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.medianThreadCost).toBe(3);
    expect(out.perCall).toBe(12 / 8);
    expect(out.cacheHitPct).toBe(40);
    expect(out.dailyBudget).toBe(50);

    const none = await s.spend({ range: "7d", projectId: "proj_c" });
    expect(none).toMatchObject({ total: 0, threadCount: 0, medianThreadCost: null, perCall: null, cacheHitPct: null, threads: [] });
  });

  it("skips entries that do not parse without deleting them, and threads that no longer exist", async () => {
    const s = await setup({
      reports: {
        thr_aaaaaa01: reportWith([day(0, 1)]),
        thr_aaaaaa02: { report: { version: 9 }, sentAt: 1, at: 1 },
        thr_aaaaaa03: reportWith([day(0, 2)]),
        thr_aaaaaa04: reportWith([day(0, 4)]),
      },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa04: { deletedAt: 5 } },
    });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out.threads.map((t) => t.threadId)).toEqual(["thr_aaaaaa01"]);
    expect(out.total).toBe(1);
    expect(out.reportedThreads).toBe(1);
    expect(await s.bb.storage.kv.get(reportKey("thr_aaaaaa02"))).toEqual({ report: { version: 9 }, sentAt: 1, at: 1 });
    expect(s.sdkCalls("threads.get").map(([args]) => (args as { threadId: string }).threadId)).toEqual(["thr_aaaaaa01"]);
  });

  it("answers with nothing reported when nothing is stored", async () => {
    const s = await setup({ reports: {}, threads: {} });
    const out = await s.spend({ range: "7d", projectId: null });
    expect(out).toMatchObject({ reportedThreads: 0, total: 0, threads: [], projects: [], projectOptions: [], models: [] });
    expect(out.days).toHaveLength(7);
    expect(s.sdkCalls("threads.experimental_listDescendants")).toEqual([]);
  });

  it("keeps thread details for about a minute", async () => {
    const s = await setup({
      reports: { thr_aaaaaa01: reportWith([day(0, 1)]), thr_aaaaaa02: reportWith([day(0, 2)]) },
      threads: { thr_aaaaaa01: {}, thr_aaaaaa02: {} },
    });
    await s.spend({ range: "7d", projectId: null });
    await s.spend({ range: "30d", projectId: "proj_a" });
    expect(s.sdkCalls("threads.get")).toHaveLength(2);
    expect(s.sdkCalls("threads.experimental_listDescendants")).toHaveLength(1);
    expect(s.sdkCalls("projects.list")).toHaveLength(1);
    s.setNow(NOW + 61_000);
    await s.spend({ range: "7d", projectId: null });
    expect(s.sdkCalls("threads.get")).toHaveLength(4);
    expect(s.sdkCalls("projects.list")).toHaveLength(2);
  });

  it("looks up at most 200 threads per descendants call", async () => {
    const reports: Record<string, UsageReport> = {};
    const threads: Record<string, Seed> = {};
    for (let i = 0; i < 450; i++) {
      const id = `thr_c${String(i).padStart(6, "0")}`;
      reports[id] = reportWith([day(i % 10, 1)]);
      threads[id] = {};
    }
    const s = await setup({ reports, threads });
    await s.spend({ range: "7d", projectId: null });
    expect(s.sdkCalls("threads.experimental_listDescendants").map(([args]) => (args as { threadIds: string[] }).threadIds.length)).toEqual([
      200, 200, 50,
    ]);
  });

  it("stays fast with 500 stored reports", async () => {
    const reports: Record<string, UsageReport> = {};
    const threads: Record<string, Seed> = {};
    for (let i = 0; i < 500; i++) {
      const id = `thr_d${String(i).padStart(6, "0")}`;
      const days = Array.from({ length: 40 }, (_, k) => day(k, 0.1 + (i % 7) + k / 10, { "p/claude-opus": 0.1 + (i % 7), [`p/m${i % 6}`]: k / 10 }, 3));
      reports[id] = reportWith(days, { running: i % 50 === 0 });
      threads[id] = { projectId: PROJECTS[i % 3]?.id, children: i % 4 };
    }
    const s = await setup({ reports, threads, budgets: { thr_d000001: 1 } });
    // The first calls in a process pay for JIT warm-up of zod and this code; measure a fresh handler, with an empty thread cache, after them.
    await s.spend({ range: "7d", projectId: null });
    await createSpendHandlers(s.deps).spend({ range: "today", projectId: null });
    const runs: number[] = [];
    let out = await createSpendHandlers(s.deps).spend({ range: "30d", projectId: null });
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      out = await createSpendHandlers(s.deps).spend({ range: "30d", projectId: null });
      runs.push(performance.now() - started);
    }
    // Warm calls take about 60 ms; the limit is loose so other test files running in parallel cannot fail it, while a quadratic regression still would.
    const elapsed = [...runs].sort((a, b) => a - b)[1] as number;
    expect(out.threadCount).toBe(500);
    expect(out.threads).toHaveLength(10);
    expect(out.models.length).toBeLessThanOrEqual(4);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("localDays and dayDate", () => {
  it("count UTC calendar days, and noon of a UTC day, when asked", () => {
    const late = Date.UTC(2026, 9, 18, 23, 30);
    expect(localDays(late, 2, 0, "utc")).toEqual(["2026-10-17", "2026-10-18"]);
    expect(localDays(late, 1, 1, "utc")).toEqual(["2026-10-17"]);
    expect(dayDate("2026-10-18", "utc").toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(dayDate("2026-10-18").getHours()).toBe(12);
  });
});

describe("daily budget alert", () => {
  const nine = (): Record<string, UsageReport> => {
    const costs = [10, 9, 8, 7, 6, 5, 4, 2, 1.1];
    return Object.fromEntries(costs.map((cost, i) => [`thr_ffffff0${i}`, reportWith([day(0, cost), day(1, 30)])]));
  };

  it("does nothing without a Daily budget", async () => {
    const s = await setup({ reports: nine(), threads: {}, daily: null });
    expect(await checkDailyBudget(s.deps)).toBeNull();
  });

  it("fires once per day when today's spend across threads reaches the budget, across re-created deps", async () => {
    const s = await setup({ reports: { thr_eeeeee01: reportWith([day(0, 20), day(1, 80)]) }, threads: {}, daily: 50 });
    expect(await checkDailyBudget(s.deps)).toBeNull();

    for (const [id, report] of Object.entries(nine())) await s.bb.storage.kv.set(reportKey(id), { report, sentAt: 2, at: 2 });
    await s.bb.storage.kv.delete(reportKey("thr_eeeeee01"));
    const alert = await checkDailyBudget(s.deps);
    expect(alert).toEqual({
      id: `daily:${ago(0)}`,
      kind: "daily",
      threadId: null,
      title: "Daily budget reached",
      body: "$52.10 spent across 9 threads today, over the $50 daily budget.",
      at: NOW,
    });
    expect(await s.bb.storage.kv.get(`daily-alert:${ago(0)}`)).toBeTruthy();
    expect(await checkDailyBudget(s.deps)).toBeNull();
    expect(await checkDailyBudget(s.makeDeps())).toBeNull();

    s.setNow(NOW + DAY_MS);
    expect(await checkDailyBudget(s.makeDeps())).toBeNull();
    await s.bb.storage.kv.set(reportKey("thr_eeeeee0x"), { report: reportWith([day(-1, 60)]), sentAt: 3, at: 3 });
    expect(await checkDailyBudget(s.makeDeps())).toMatchObject({
      id: `daily:${ago(-1)}`,
      body: "$60.00 spent across 1 thread today, over the $50 daily budget.",
    });
  });

  it("marks the day's spend as an estimate when a thread that spent today is one", async () => {
    const s = await setup({ reports: {}, threads: {}, daily: 1 });
    const reports = async () => [
      { threadId: "thr_eeeeee01", report: reportWith([day(0, 0.6)], { estimated: true }) },
      { threadId: "thr_eeeeee02", report: reportWith([day(0, 0.5)]) },
      { threadId: "thr_eeeeee03", report: reportWith([day(1, 9)], { estimated: true }) },
    ];
    expect(await checkDailyBudget({ ...s.deps, reports })).toMatchObject({ body: "~$1.10 spent across 2 threads today, over the $1 daily budget." });
  });

  it("fires once when two reports arrive together", async () => {
    const s = await setup({ reports: nine(), threads: {}, daily: 50 });
    const both = await Promise.all([checkDailyBudget(s.deps), checkDailyBudget(s.makeDeps())]);
    expect(both.filter((a) => a !== null)).toHaveLength(1);
  });

  it("skips entries that do not parse", async () => {
    const s = await setup({
      reports: { thr_eeeeee01: reportWith([day(0, 49)]), thr_eeeeee02: { report: { version: 9, days: [{ day: ago(0), cost: 100 }] }, sentAt: 1, at: 1 } },
      threads: {},
      daily: 50,
    });
    expect(await checkDailyBudget(s.deps)).toBeNull();
  });
});
