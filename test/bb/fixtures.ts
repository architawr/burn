import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { CostRow, rpcContract, UsageAnswer } from "../../extensions/bb/contract.js";
import { sampleReport } from "../helpers.js";

export const THREAD = "thr_aaaaaaaa";
export const CHILD = "thr_cccccccc";
export const OTHER = "thr_bbbbbbbb";
export const QUIET = { budget: null, stopAtBudget: false, notifyExpensiveTurn: false };

export function answer(over: Partial<UsageAnswer> = {}): UsageAnswer {
  return {
    report: sampleReport(),
    source: "pi",
    reportedAt: Date.now() - 12_000,
    title: "burn UX polish",
    budget: null,
    policy: QUIET,
    family: { total: 4.82, calls: 23, children: [] },
    ...over,
  };
}

export const costRow = (over: Partial<CostRow> & { threadId: string }): CostRow => ({
  cost: 4.82,
  label: "$4.82",
  familyCost: null,
  budget: null,
  state: "none",
  ...over,
});

type Handlers = PluginRpcTestHandlers<typeof rpcContract>;

/** Every rpc method, answering `usage` with `usage()` and recording the calls. */
export function backend(usage: () => UsageAnswer = () => answer(), over: Partial<Handlers> = {}) {
  const calls: { method: string; input: unknown }[] = [];
  const record =
    <I, O>(method: string, fn: (input: I) => O) =>
    (input: I): O => {
      calls.push({ method, input });
      return fn(input);
    };
  const rpc: Handlers = {
    usage: record("usage", over.usage ?? (() => usage())),
    setBudget: record("setBudget", over.setBudget ?? (() => ({ budget: null, policy: QUIET }))),
    costs: record("costs", over.costs ?? (({ threadIds }) => ({ threads: threadIds.map((threadId) => costRow({ threadId })) }))),
    overBudget: record("overBudget", over.overBudget ?? (() => ({ threads: [] }))),
    spend: record(
      "spend",
      over.spend ??
        (() => {
          throw new Error("the Spend page is not part of these tests");
        }),
    ),
  };
  return { rpc, calls, callsTo: (method: string) => calls.filter((c) => c.method === method) };
}
