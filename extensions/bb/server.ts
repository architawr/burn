import type { BbPluginApi, PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { budgetState, EXPENSIVE_MIN_USD, EXPENSIVE_MULTIPLE } from "../../src/budget.js";
import { formatUsd, usageLabel } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import type { UsageReply } from "../../src/wire.js";
import { ALERT_CHANNEL } from "./alerts.js";
import { effectiveBudget, type OwnBudget, policyFor, positiveOrNull } from "./budgets.js";
import { BUDGET_MAX, type CostRow, type Family, rpcContract } from "./contract.js";
import { budgetKey, REPORT_PREFIX, reportKey } from "./keys.js";
import { createLogReports } from "./logs.js";
import { alertEvents, alertFor } from "./notify.js";
import { type Stored, storedSchema, usageEnvelopeSchema } from "./schema.js";
import { checkDailyBudget, createSpendHandlers, type SpendDeps } from "./spend/server.js";

export { rpcContract } from "./contract.js";

const REPORT_MAX_BYTES = 128 * 1024;
const MAX_THREADS = 500;
const TITLE_TTL_MS = 60_000;
const CHILDREN_MAX = 50;
const UNTITLED = "Untitled thread";

const budgetSetting = z
  .number()
  .positive("Enter an amount above zero, or leave it empty for no budget.")
  .max(BUDGET_MAX, "Enter an amount up to $1,000,000.");

export const SETTINGS = {
  chip: {
    type: "boolean",
    label: "Cost chip",
    description:
      "Shows what the thread has cost beside the context circle under the prompt box, or in the thread header when that row is not on screen. Click it for the breakdown.",
    default: true,
  },
  chipShows: {
    type: "select",
    label: "Chip shows",
    description: "What the chip reads between prompts: the total and, for a few seconds after each prompt, what it added; or the total alone.",
    options: ["delta", "cost"],
    experimental_optionLabels: { delta: "Cost and last turn", cost: "Cost only" },
    default: "delta",
  },
  threadBudget: {
    type: "number",
    label: "Thread budget",
    description:
      "Dollars per thread. The chip turns amber at 80% and red at 100%. A thread's own budget, set from the chip, the Burn panel or the thread menu, overrides it. Empty means no budget.",
    experimental_schema: budgetSetting,
  },
  dailyBudget: {
    type: "number",
    label: "Daily budget",
    description: "Dollars per day across all threads. Burn notifies you once a day when all threads together pass it. Empty means no daily budget.",
    experimental_schema: budgetSetting,
  },
  budgetAlerts: {
    type: "boolean",
    label: "Budget alerts",
    description: "Notifies you when a thread reaches 80% and 100% of its budget, once each.",
    default: true,
  },
  stopAtBudget: {
    type: "boolean",
    label: "Stop a thread at its budget",
    description:
      "Off by default: Burn never stops a thread unless you turn this on. When on, Burn stops only the pi run whose cost crosses the thread's budget. Send another prompt to continue; Burn does not stop a thread that is already over its budget again.",
    default: false,
  },
  flagOverBudget: {
    type: "boolean",
    label: "Flag threads over budget in the sidebar",
    description: "A red flame replaces the status glyph of a thread that is over its budget.",
    default: true,
  },
  notifyExpensiveTurn: {
    type: "boolean",
    label: "Notify after an unusually expensive turn",
    description: `Off by default. When on, Burn notifies you after a prompt that costs at least ${EXPENSIVE_MULTIPLE} times the thread's median turn and at least ${formatUsd(EXPENSIVE_MIN_USD)}.`,
    default: false,
  },
} satisfies PluginSettingDescriptors;

const ownBudgetSchema = z.object({ budget: z.number().finite().positive().nullable() });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Keeps `map` to the `max` most recently set keys. */
function remember<V>(map: Map<string, V>, key: string, value: V, max = MAX_THREADS): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

const topModel = (report: UsageReport): string | null => report.byModel[0]?.key ?? null;

/** A thread's report and where it came from: its pi, or its session log. `at` is when it last changed. */
interface Resolved {
  report: UsageReport;
  source: "pi" | "log";
  at: number;
}

/** Burn 0.1 sent no prompts or days; the schema upgrades such a report with none. */
const fromBurn01 = (report: UsageReport): boolean => report.turnCount === 0 && report.calls > 0;

const THREAD_PAGE = 200;
const THREAD_PAGES_MAX = 50;
const THREAD_LIST_TTL_MS = 60_000;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define(SETTINGS);
  const reports = new Map<string, Stored>();
  const budgets = new Map<string, OwnBudget>();
  const titles = new Map<string, { title: string | null; at: number }>();
  const logs = createLogReports(bb);
  let piThreads: { at: number; threads: { id: string; updatedAt: number }[] } | null = null;

  async function load(threadId: string): Promise<Stored | null> {
    const held = reports.get(threadId);
    if (held) return held;
    const raw = await bb.storage.kv.get<unknown>(reportKey(threadId));
    if (raw === undefined) return null;
    const parsed = storedSchema.safeParse(raw);
    if (!parsed.success) {
      await bb.storage.kv.delete(reportKey(threadId));
      return null;
    }
    remember(reports, threadId, parsed.data);
    return parsed.data;
  }

  /**
   * The thread's own report when its pi reports to Burn, else one read from its
   * session log: threads started before Burn was installed, and their children,
   * never report but still cost money.
   */
  async function resolve(threadId: string): Promise<Resolved | null> {
    const stored = await load(threadId);
    if (stored && !fromBurn01(stored.report)) return { report: stored.report, source: "pi", at: stored.at };
    const log = await logs.reportOf(threadId);
    if (log) return { report: log.report, source: "log", at: log.at };
    return stored ? { report: stored.report, source: "pi", at: stored.at } : null;
  }

  /** Every pi thread bb knows, archived and hidden ones included, listed at most once a minute. */
  async function listPiThreads(): Promise<{ id: string; updatedAt: number }[]> {
    if (piThreads && Date.now() - piThreads.at < THREAD_LIST_TTL_MS) return piThreads.threads;
    const found: { id: string; updatedAt: number }[] = [];
    for (let page = 0; page < THREAD_PAGES_MAX; page++) {
      const rows = await bb.sdk.threads.list({ includeHidden: true, limit: THREAD_PAGE, offset: page * THREAD_PAGE });
      for (const t of rows) if (t.providerId === "pi" && t.deletedAt === null) found.push({ id: t.id, updatedAt: t.updatedAt });
      if (rows.length < THREAD_PAGE) break;
    }
    piThreads = { at: Date.now(), threads: found };
    return found;
  }

  /** Reports of every thread that reported, and of every pi thread active since `since` that did not. */
  async function threadReports(since: number): Promise<{ threadId: string; report: UsageReport }[]> {
    const ids = new Set((await bb.storage.kv.list(REPORT_PREFIX)).map((key) => key.slice(REPORT_PREFIX.length)));
    try {
      for (const t of await listPiThreads()) if (t.updatedAt >= since) ids.add(t.id);
    } catch (err) {
      bb.log.warn(`listing pi threads failed, so only reporting threads count: ${message(err)}`);
    }
    const out: { threadId: string; report: UsageReport }[] = [];
    // One at a time: a log can be megabytes, and parsing many at once would hold up the server.
    for (const threadId of ids) {
      const got = await resolve(threadId);
      if (got) out.push({ threadId, report: got.report });
    }
    return out;
  }

  async function ownBudget(threadId: string): Promise<OwnBudget> {
    if (budgets.has(threadId)) return budgets.get(threadId);
    const raw = await bb.storage.kv.get<unknown>(budgetKey(threadId));
    let own: OwnBudget;
    if (raw !== undefined) {
      const parsed = ownBudgetSchema.safeParse(raw);
      if (parsed.success) own = parsed.data.budget;
      else await bb.storage.kv.delete(budgetKey(threadId));
    }
    remember(budgets, threadId, own);
    return own;
  }

  type Values = Awaited<ReturnType<typeof settings.get>>;

  async function budgetOf(threadId: string, report: UsageReport | null, values?: Values) {
    const { threadBudget } = values ?? (await settings.get());
    return effectiveBudget(await ownBudget(threadId), threadBudget, report?.budget ?? null);
  }

  async function policyOf(threadId: string) {
    return policyFor(await ownBudget(threadId), await settings.get());
  }

  /** The thread's title, cached briefly; null when bb cannot say (the failure is logged once per TTL). */
  async function titleOf(threadId: string): Promise<string | null> {
    const cached = titles.get(threadId);
    if (cached && Date.now() - cached.at < TITLE_TTL_MS) return cached.title;
    let title: string | null = null;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      title = thread.title ?? thread.titleFallback ?? null;
    } catch (err) {
      bb.log.warn(`looking up the title of ${threadId} failed: ${message(err)}`);
    }
    remember(titles, threadId, { title, at: Date.now() });
    return title;
  }

  async function descendantsOf(threadIds: readonly string[]): Promise<Map<string, string[]>> {
    try {
      const { threads } = await bb.sdk.threads.experimental_listDescendants({ threadIds });
      return new Map(threads.map((t) => [t.threadId, t.descendantIds]));
    } catch (err) {
      bb.log.warn(`listing the child threads of ${threadIds.length} thread(s) failed: ${message(err)}`);
      return new Map();
    }
  }

  async function childReports(descendantIds: readonly string[]): Promise<{ id: string; report: UsageReport }[]> {
    const out: { id: string; report: UsageReport }[] = [];
    for (const id of descendantIds) {
      const got = await resolve(id);
      if (got) out.push({ id, report: got.report });
    }
    return out;
  }

  async function familyOf(report: UsageReport | null, descendantIds: readonly string[]): Promise<Family> {
    const reported = await childReports(descendantIds);
    const total = reported.reduce((sum, c) => sum + c.report.cost.total, report?.cost.total ?? 0);
    const calls = reported.reduce((sum, c) => sum + c.report.calls, report?.calls ?? 0);
    const costliest = reported.sort((a, b) => b.report.cost.total - a.report.cost.total).slice(0, CHILDREN_MAX);
    const children = await Promise.all(
      costliest.map(async ({ id, report: r }) => ({
        threadId: id,
        title: (await titleOf(id)) ?? UNTITLED,
        cost: r.cost.total,
        calls: r.calls,
        running: r.running,
        model: topModel(r),
      })),
    );
    return { total, calls, children };
  }

  async function costRow(threadId: string, descendantIds: readonly string[], values: Values): Promise<CostRow> {
    const report = (await resolve(threadId))?.report ?? null;
    const budget = await budgetOf(threadId, report, values);
    const children = await childReports(descendantIds);
    const cost = report?.cost.total ?? 0;
    return {
      threadId,
      cost: report ? cost : null,
      label: report ? usageLabel(report) : null,
      familyCost: children.length > 0 ? children.reduce((sum, c) => sum + c.report.cost.total, cost) : null,
      budget,
      state: budgetState(cost, budget?.amount),
    };
  }

  const spendDeps: SpendDeps = {
    bb,
    budgetOf: async (threadId, report) => (await budgetOf(threadId, report))?.amount ?? null,
    dailyBudget: async () => positiveOrNull((await settings.get()).dailyBudget),
    reports: threadReports,
  };

  /** Publishes the toasts a newly stored report earns. Runs after the reply, so a slow title lookup never delays pi. */
  async function announce(threadId: string, prev: UsageReport | null, next: UsageReport): Promise<void> {
    const values = await settings.get();
    const budget = (await budgetOf(threadId, next, values))?.amount ?? null;
    const events = alertEvents(prev, next, { budget, budgetAlerts: values.budgetAlerts, notifyExpensiveTurn: values.notifyExpensiveTurn });
    if (events.length > 0) {
      const title = (await titleOf(threadId)) ?? UNTITLED;
      for (const event of events) bb.realtime.publish(ALERT_CHANNEL, alertFor(event, threadId, title, Date.now()));
    }
    const daily = await checkDailyBudget(spendDeps);
    if (daily !== null) bb.realtime.publish(ALERT_CHANNEL, daily);
  }

  bb.rpc.register(rpcContract, {
    usage: async ({ threadId }) => {
      const resolved = await resolve(threadId);
      const report = resolved?.report ?? null;
      const descendants = await descendantsOf([threadId]);
      const [budget, policy, title, family] = await Promise.all([
        budgetOf(threadId, report),
        policyOf(threadId),
        titleOf(threadId),
        familyOf(report, descendants.get(threadId) ?? []),
      ]);
      return { report, source: resolved?.source ?? null, reportedAt: resolved?.at ?? null, title, budget, policy, family };
    },
    setBudget: async ({ threadId, budget }) => {
      if (budget === "default") await bb.storage.kv.delete(budgetKey(threadId));
      else await bb.storage.kv.set(budgetKey(threadId), { budget });
      remember(budgets, threadId, budget === "default" ? undefined : budget);
      bb.realtime.publish("usage", { threadId });
      const report = (await resolve(threadId))?.report ?? null;
      return { budget: await budgetOf(threadId, report), policy: await policyOf(threadId) };
    },
    costs: async ({ threadIds }) => {
      const [descendants, values] = await Promise.all([descendantsOf(threadIds), settings.get()]);
      return { threads: await Promise.all(threadIds.map((id) => costRow(id, descendants.get(id) ?? [], values))) };
    },
    overBudget: async () => {
      const [keys, values] = await Promise.all([bb.storage.kv.list(REPORT_PREFIX), settings.get()]);
      const rows = await Promise.all(
        keys.map(async (key) => {
          const threadId = key.slice(REPORT_PREFIX.length);
          const stored = await load(threadId);
          if (stored === null) return null;
          const budget = await budgetOf(threadId, stored.report, values);
          const cost = stored.report.cost.total;
          return budget !== null && budgetState(cost, budget.amount) === "over" ? { threadId, cost, budget: budget.amount } : null;
        }),
      );
      return { threads: rows.filter((r) => r !== null) };
    },
    ...createSpendHandlers(spendDeps),
  });

  // The Burn pi extension reports each change here (extensions/pi/bb-report.ts) and applies the policy in the reply.
  bb.http.route("POST", "/usage", async (c) => {
    const text = await c.req.text();
    if (text.length > REPORT_MAX_BYTES) return c.json({ ok: false, error: "usage report too large" } satisfies UsageReply, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ ok: false, error: "usage report is not JSON" } satisfies UsageReply, 400);
    }
    const envelope = usageEnvelopeSchema.safeParse(body);
    if (!envelope.success) return c.json({ ok: false, error: "invalid usage report" } satisfies UsageReply, 400);
    const { threadId, sentAt, report } = envelope.data;
    const policy = await policyOf(threadId);
    const held = await load(threadId);
    if (held && sentAt < held.sentAt) return c.json({ ok: true, policy } satisfies UsageReply);
    const stored: Stored = { report, sentAt, at: Date.now() };
    remember(reports, threadId, stored);
    try {
      await bb.storage.kv.set(reportKey(threadId), stored);
    } catch (err) {
      bb.log.warn(`saving the usage report of ${threadId} failed: ${message(err)}`);
    }
    bb.realtime.publish("usage", { threadId });
    announce(threadId, held?.report ?? null, report).catch((err: unknown) => {
      bb.log.warn(`publishing the alerts of ${threadId} failed: ${message(err)}`);
    });
    return c.json({ ok: true, policy } satisfies UsageReply);
  });

  bb.providers.experimental_contributeEnv("pi", () => [
    {
      name: "BURN_BB_URL",
      value: { serverPath: `/api/v1/plugins/${bb.pluginId}/http/usage` },
      reason: "Where the Burn pi extension reports this thread's cost to the Burn plugin",
    },
  ]);

  bb.events.on("thread.deleted", async ({ thread }) => {
    reports.delete(thread.id);
    budgets.delete(thread.id);
    logs.forget(thread.id);
    titles.delete(thread.id);
    try {
      await Promise.all([bb.storage.kv.delete(reportKey(thread.id)), bb.storage.kv.delete(budgetKey(thread.id))]);
    } catch (err) {
      bb.log.warn(`forgetting the usage report of ${thread.id} failed: ${message(err)}`);
    }
  });
}
