import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { budgetState } from "../../../src/budget.js";
import { formatBudget, formatUsd, median, modelName } from "../../../src/format.js";
import { type DayRow, dayKey, OTHER_KEY, TOOLS_KEY, type UsageReport } from "../../../src/report.js";
import type { BurnAlert } from "../alerts.js";
import { REPORT_PREFIX } from "../keys.js";
import { type Stored, storedSchema } from "../schema.js";
import type { SpendOutput, SpendRange, SpendZone } from "./contract.js";
import { dayDate, localDays, RANGE_DAYS } from "./days.js";

export interface SpendDeps {
  bb: BbPluginApi;
  /** The budget that applies to a thread: its own, else the setting, else the one pi reported. */
  budgetOf(threadId: string, report: UsageReport): Promise<number | null>;
  /** The Daily budget setting, or null when unset. */
  dailyBudget(): Promise<number | null>;
  /**
   * Every thread's report that may have spend since `since`. server.ts adds
   * threads that never reported, read from their session logs; without it,
   * only the reports stored in KV count.
   */
  reports?(since: number): Promise<Entry[]>;
  now?: () => number;
}

export const DAILY_ALERT_PREFIX = "daily-alert:";
export const dailyAlertKey = (day: string): string => `${DAILY_ALERT_PREFIX}${day}`;

const META_TTL_MS = 60_000;
const DAY_MS = 86_400_000;
const TOP_THREADS = 10;
const CHART_MODELS = 4;
/** `experimental_listDescendants` takes 1–200 ids per call. */
const SDK_BATCH = 200;
const SDK_CONCURRENCY = 8;
const UNTITLED = "Untitled thread";
const UNKNOWN_PROJECT = "Unknown project";

interface ThreadMeta {
  title: string;
  projectId: string;
  childCount: number;
}

export interface Entry {
  threadId: string;
  report: UsageReport;
}

interface Counted extends Entry {
  meta: ThreadMeta;
  rangeCost: number;
  calls: number;
}

const add = (map: Map<string, number>, key: string, cost: number): void => {
  map.set(key, (map.get(key) ?? 0) + cost);
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const parse = (raw: unknown): Stored | null => {
  const parsed = storedSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** Every stored report entry, unparsed. */
async function readEntries(bb: BbPluginApi): Promise<{ key: string; raw: unknown }[]> {
  const keys = await bb.storage.kv.list(REPORT_PREFIX);
  const raws = await Promise.all(keys.map((key) => bb.storage.kv.get<unknown>(key)));
  return keys.flatMap((key, i) => (raws[i] === undefined ? [] : [{ key, raw: raws[i] }]));
}

/** Every stored report that parses; entries that do not are skipped and left alone. */
async function readReports(bb: BbPluginApi): Promise<Entry[]> {
  return (await readEntries(bb)).flatMap(({ key, raw }) => {
    const stored = parse(raw);
    return stored ? [{ threadId: key.slice(REPORT_PREFIX.length), report: stored.report }] : [];
  });
}

/** The costliest keys, Other last; past `max` keys, the rest fold into Other. */
function topKeys(costs: Map<string, number>, max: number): { keys: string[]; fold: (key: string) => string } {
  const sorted = [...costs.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  const named = sorted.filter((k) => k !== OTHER_KEY);
  const head = new Set(sorted.length <= max ? named : named.slice(0, max - 1));
  const keys = head.size < sorted.length ? [...head, OTHER_KEY] : [...head];
  return { keys, fold: (key) => (head.has(key) ? key : OTHER_KEY) };
}

/** A report's spend per day in `zone`. Burn 0.2 sent no UTC days, so its local days stand in for them. */
const daysIn = (report: UsageReport, zone: SpendZone): DayRow[] =>
  zone === "utc" && report.utcDays.length > 0 ? report.utcDays : report.days;

function rangeModels(days: readonly DayRow[], inRange: ReadonlySet<string>): Map<string, number> {
  const models = new Map<string, number>();
  for (const d of days) if (inRange.has(d.day)) for (const m of d.models) add(models, m.key, m.cost);
  return models;
}

function topModel(models: Map<string, number>, report: UsageReport): string | null {
  const isModel = (key: string): boolean => key !== OTHER_KEY && key !== TOOLS_KEY;
  const ranked = [...models.entries()].filter(([k, c]) => isModel(k) && c > 0).sort((a, b) => b[1] - a[1]);
  const key = ranked[0]?.[0] ?? report.byModel.find((m) => isModel(m.key))?.key;
  return key === undefined ? null : modelName(key);
}

export function createSpendHandlers(deps: SpendDeps): {
  spend(input: { range: SpendRange; projectId: string | null; tz?: SpendZone }): Promise<SpendOutput>;
} {
  const now = deps.now ?? Date.now;
  const { bb } = deps;
  const threads = new Map<string, { at: number; meta: ThreadMeta | null }>();
  let projects: { at: number; names: Map<string, string> } | null = null;

  async function projectNames(): Promise<Map<string, string>> {
    if (projects && now() - projects.at < META_TTL_MS) return projects.names;
    const list = await bb.sdk.projects.list({ includePersonal: true });
    projects = { at: now(), names: new Map(list.map((p) => [p.id, p.name])) };
    return projects.names;
  }

  /** Title, project and child count of each thread that still exists; missing threads are left out. */
  async function threadMeta(ids: readonly string[]): Promise<Map<string, ThreadMeta>> {
    const at = now();
    const stale = ids.filter((id) => {
      const held = threads.get(id);
      return !held || at - held.at >= META_TTL_MS;
    });
    const children = new Map<string, number>();
    for (const batch of chunks(stale, SDK_BATCH)) {
      const { threads: found } = await bb.sdk.threads.experimental_listDescendants({
        threadIds: batch,
        includeArchived: true,
        includeHidden: true,
      });
      for (const t of found) children.set(t.threadId, t.descendantIds.length);
    }
    const live = [...children.keys()];
    const got = await mapLimit(live, SDK_CONCURRENCY, (threadId) => bb.sdk.threads.get({ threadId }));
    const fresh = new Map(
      got.map((t): [string, ThreadMeta] => [
        t.id,
        { title: t.title || t.titleFallback || UNTITLED, projectId: t.projectId, childCount: children.get(t.id) ?? 0 },
      ]),
    );
    for (const id of stale) threads.set(id, { at, meta: fresh.get(id) ?? null });
    const wanted = new Set(ids);
    for (const id of threads.keys()) if (!wanted.has(id)) threads.delete(id);
    const out = new Map<string, ThreadMeta>();
    for (const id of ids) {
      const meta = threads.get(id)?.meta;
      if (meta) out.set(id, meta);
    }
    return out;
  }

  return {
    async spend({ range, projectId, tz = "local" }) {
      const today = now();
      const length = RANGE_DAYS[range];
      const dayList = localDays(today, length, 0, tz);
      const inRange: ReadonlySet<string> = new Set(dayList);
      const before = new Set(localDays(today, length, length, tz));

      // A day of slack: the range and the period before it, whatever daylight saving does.
      const since = dayDate(dayList[0] as string, tz).getTime() - (length + 1) * DAY_MS;
      const entries = deps.reports ? await deps.reports(since) : await readReports(bb);
      const [metas, names, dailyBudget] = await Promise.all([
        threadMeta(entries.map((e) => e.threadId)),
        entries.length > 0 ? projectNames() : new Map<string, string>(),
        deps.dailyBudget(),
      ]);

      const options = new Map<string, string>();
      const counted: Counted[] = [];
      const byModel = new Map<string, number>();
      const perDay = new Map(dayList.map((d) => [d, { cost: 0, models: new Map<string, number>() }]));
      let previousTotal = 0;
      let reportedThreads = 0;
      for (const entry of entries) {
        const meta = metas.get(entry.threadId);
        if (!meta) continue;
        reportedThreads++;
        const name = names.get(meta.projectId);
        if (name !== undefined) options.set(meta.projectId, name);
        if (projectId !== null && meta.projectId !== projectId) continue;
        let rangeCost = 0;
        let calls = 0;
        for (const d of daysIn(entry.report, tz)) {
          if (before.has(d.day)) previousTotal += d.cost;
          const slot = perDay.get(d.day);
          if (!slot) continue;
          rangeCost += d.cost;
          calls += d.calls;
          slot.cost += d.cost;
          for (const m of d.models) {
            add(slot.models, m.key, m.cost);
            add(byModel, m.key, m.cost);
          }
        }
        if (rangeCost > 0) counted.push({ ...entry, meta, rangeCost, calls });
      }

      const { keys, fold } = topKeys(byModel, CHART_MODELS);
      const days: SpendOutput["days"] = dayList.map((day) => {
        const slot = perDay.get(day) ?? { cost: 0, models: new Map<string, number>() };
        const folded = new Map<string, number>();
        for (const [key, cost] of slot.models) add(folded, fold(key), cost);
        const models = keys.flatMap((key) => {
          const cost = folded.get(key) ?? 0;
          return cost > 0 ? [{ key, cost }] : [];
        });
        return { day, cost: slot.cost, models };
      });
      const folded = new Map<string, number>();
      for (const [key, cost] of byModel) add(folded, fold(key), cost);
      const models = keys.map((key) => ({ key, cost: folded.get(key) ?? 0 }));

      const budgets = await Promise.all(counted.map((row) => deps.budgetOf(row.threadId, row.report)));
      const overBudgetCount = counted.filter((row, i) => budgetState(row.report.cost.total, budgets[i]) === "over").length;

      const byProject = new Map<string, number>();
      for (const row of counted) add(byProject, row.meta.projectId, row.rangeCost);
      const projectRows: SpendOutput["projects"] = [...byProject.entries()]
        .map(([id, cost]) => {
          const name = names.get(id);
          return name === undefined ? { projectId: null, name: UNKNOWN_PROJECT, cost } : { projectId: id, name, cost };
        })
        .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

      const order = counted.map((row, i) => ({ row, budget: budgets[i] ?? null }));
      order.sort((a, b) => b.row.rangeCost - a.row.rangeCost || b.row.report.cost.total - a.row.report.cost.total || a.row.threadId.localeCompare(b.row.threadId));
      const top: SpendOutput["threads"] = order.slice(0, TOP_THREADS).map(({ row, budget }) => ({
        threadId: row.threadId,
        title: row.meta.title,
        projectName: names.get(row.meta.projectId) ?? null,
        model: topModel(rangeModels(daysIn(row.report, tz), inRange), row.report),
        childCount: row.meta.childCount,
        calls: row.calls,
        rangeCost: row.rangeCost,
        total: row.report.cost.total,
        budget,
        running: row.report.running,
      }));

      const total = counted.reduce((sum, row) => sum + row.rangeCost, 0);
      const calls = counted.reduce((sum, row) => sum + row.calls, 0);
      let cacheRead = 0;
      let prompt = 0;
      for (const { report } of counted) {
        cacheRead += report.tokens.cacheRead;
        prompt += report.tokens.input + report.tokens.cacheRead + report.tokens.cacheWrite;
      }

      return {
        range,
        tz,
        days,
        total,
        previousTotal,
        threadCount: counted.length,
        overBudgetCount,
        medianThreadCost: median(counted.map((row) => row.rangeCost)),
        perCall: calls > 0 ? total / calls : null,
        cacheHitPct: prompt > 0 ? (cacheRead / prompt) * 100 : null,
        threads: top,
        projects: projectRows,
        models,
        projectOptions: [...options.entries()]
          .map(([id, name]) => ({ projectId: id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        dailyBudget,
        reportedThreads,
      };
    },
  };
}

/**
 * Parsed reports by KV key, per plugin load. server.ts stamps `at` on every
 * write, so an entry whose `sentAt` and `at` are unchanged is the same report
 * and is not parsed again on every incoming report. Only the days are kept.
 */
const daysByHost = new WeakMap<BbPluginApi, Map<string, { sig: string; days: DayRow[] | null }>>();
const dailyChecks = new WeakMap<BbPluginApi, Promise<unknown>>();

function signature(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { sentAt, at } = raw as { sentAt?: unknown; at?: unknown };
  return typeof sentAt === "number" && typeof at === "number" ? `${sentAt}:${at}` : null;
}

async function todaySpend(bb: BbPluginApi, today: string): Promise<{ cost: number; threads: number }> {
  const memo = daysByHost.get(bb) ?? new Map<string, { sig: string; days: DayRow[] | null }>();
  daysByHost.set(bb, memo);
  const entries = await readEntries(bb);
  const seen = new Set(entries.map((e) => e.key));
  for (const key of memo.keys()) if (!seen.has(key)) memo.delete(key);
  let cost = 0;
  let threads = 0;
  for (const { key, raw } of entries) {
    const sig = signature(raw);
    const held = memo.get(key);
    let days: DayRow[] | null;
    if (sig !== null && held?.sig === sig) days = held.days;
    else {
      days = parse(raw)?.report.days ?? null;
      if (sig !== null) memo.set(key, { sig, days });
    }
    const spent = days?.find((d) => d.day === today)?.cost ?? 0;
    if (spent > 0) threads++;
    cost += spent;
  }
  return { cost, threads };
}

function todayFrom(entries: Entry[], today: string): { cost: number; threads: number } {
  let cost = 0;
  let threads = 0;
  for (const { report } of entries) {
    const spent = report.days.find((d) => d.day === today)?.cost ?? 0;
    if (spent > 0) threads++;
    cost += spent;
  }
  return { cost, threads };
}

async function checkOnce(deps: SpendDeps): Promise<BurnAlert | null> {
  const budget = await deps.dailyBudget();
  if (budget === null || !(budget > 0)) return null;
  const at = (deps.now ?? Date.now)();
  const today = dayKey(at);
  const key = dailyAlertKey(today);
  if ((await deps.bb.storage.kv.get(key)) !== undefined) return null;
  const { cost, threads } = deps.reports ? todayFrom(await deps.reports(dayDate(today).getTime() - DAY_MS), today) : await todaySpend(deps.bb, today);
  if (cost < budget) return null;
  await deps.bb.storage.kv.set(key, { at });
  return {
    id: `daily:${today}`,
    kind: "daily",
    threadId: null,
    title: "Daily budget reached",
    body: `${formatUsd(cost)} spent across ${threads} ${threads === 1 ? "thread" : "threads"} today, over the ${formatBudget(budget)} daily budget.`,
    at,
  };
}

/**
 * server.ts calls this after storing each report; it returns the daily-budget
 * alert once per local day when the day's spend across all threads first
 * reaches the Daily budget setting, else null. Checks run one at a time per
 * plugin load, so two reports arriving together cannot both fire it.
 */
export function checkDailyBudget(deps: SpendDeps): Promise<BurnAlert | null> {
  const run = (dailyChecks.get(deps.bb) ?? Promise.resolve()).then(() => checkOnce(deps));
  dailyChecks.set(
    deps.bb,
    run.catch(() => undefined),
  );
  return run;
}
