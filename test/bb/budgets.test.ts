import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { bbBudget, budgetWords, effectiveBudget } from "../../extensions/bb/budgets.js";
import { alertEvents, alertFor } from "../../extensions/bb/notify.js";
import { registerPanelOpener, requestPanel } from "../../extensions/bb/panel-requests.js";
import { sampleReport } from "../helpers.js";

describe("effectiveBudget", () => {
  it("prefers the thread's own budget, then the setting, then pi's", () => {
    expect(effectiveBudget(5, 10, 3)).toEqual({ amount: 5, source: "thread" });
    expect(effectiveBudget(undefined, 10, 3)).toEqual({ amount: 10, source: "setting" });
    expect(effectiveBudget(undefined, undefined, 3)).toEqual({ amount: 3, source: "pi" });
    expect(effectiveBudget(undefined, 0, null)).toBeNull();
  });

  it("treats a thread's explicit no-budget as overriding the setting, leaving pi's own", () => {
    expect(bbBudget(null, 10)).toBeNull();
    expect(effectiveBudget(null, 10, null)).toBeNull();
    expect(effectiveBudget(null, 10, 3)).toEqual({ amount: 3, source: "pi" });
  });

  it("words a budget's share and what is left", () => {
    expect(budgetWords(4.82, { amount: 10, source: "setting" })).toEqual({ share: "48% of the $10 thread budget", left: "$5.18 left" });
    expect(budgetWords(12.4, { amount: 7.5, source: "pi" })).toEqual({ share: "165% of the $7.50 budget set in pi", left: "$4.90 over" });
  });
});

describe("alertEvents", () => {
  const opts = { budget: 10, budgetAlerts: true, notifyExpensiveTurn: true };
  const costOf = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total });

  it("jumps straight to over when one report crosses both thresholds", () => {
    const events = alertEvents(sampleReport({ cost: costOf(5) }), sampleReport({ cost: costOf(11) }), opts);
    expect(events).toEqual([{ kind: "over", cost: 11, budget: 10, estimated: false }]);
    expect(alertFor(events[0]!, "thr_aaaaaaaa", "Job", 7)).toEqual({
      id: "over:thr_aaaaaaaa:10",
      kind: "over",
      threadId: "thr_aaaaaaaa",
      title: "“Job” is over its budget",
      body: "$11.00 spent, over the $10 thread budget.",
      at: 7,
    });
  });

  it("checks the turn that just ended when the next prompt starts", () => {
    const turns = sampleReport().turns.map((t) => ({ ...t, cost: t.n === 4 ? 2 : 0.2 }));
    const prev = sampleReport({ turns, turnCount: 4, running: false });
    const next = sampleReport({ turns: [...turns, { ...turns[0]!, n: 5, cost: 0 }], turnCount: 5, running: true });
    expect(alertEvents(prev, next, opts).map((e) => (e.kind === "expensive" ? e.turn.n : e.kind))).toEqual([4]);
    expect(alertEvents(prev, next, { ...opts, notifyExpensiveTurn: false })).toEqual([]);
  });

  it("marks the amounts of a thread whose cost is a list-price estimate", () => {
    const near = alertEvents(sampleReport({ cost: costOf(5) }), sampleReport({ cost: costOf(8.5), estimated: true }), opts);
    expect(near).toEqual([{ kind: "near", cost: 8.5, budget: 10, estimated: true }]);
    expect(alertFor(near[0]!, "thr_aaaaaaaa", "Job", 7).body).toBe("~$8.50 of the $10 thread budget (85%).");
    expect(alertFor({ kind: "over", cost: 11, budget: 10, estimated: true }, "thr_aaaaaaaa", "Job", 7).body).toBe("~$11.00 spent, over the $10 thread budget.");

    const turns = sampleReport().turns.map((t) => ({ ...t, cost: t.n === 4 ? 2 : 0.2 }));
    const prev = sampleReport({ turns, turnCount: 4, running: false });
    const next = sampleReport({ turns: [...turns, { ...turns[0]!, n: 5, cost: 0 }], turnCount: 5, running: true, estimated: true });
    const [expensive] = alertEvents(prev, next, opts);
    expect(expensive).toMatchObject({ kind: "expensive", estimated: true });
    expect(alertFor(expensive!, "thr_aaaaaaaa", "Job", 7).body).toBe("Turn 4 cost ~$2.00, 10.0 times the thread's median turn.");
  });
});

describe("panel requests", () => {
  const navigate = (log: unknown[]) => ({ toThread: (id: string) => log.push(id) }) as unknown as BbNavigate;

  it("serves a waiting request when the thread's chip mounts, but not a stale one", () => {
    const log: unknown[] = [];
    requestPanel(navigate(log), "thr_pppppppp", { focus: "budget" }, 1000);
    expect(log).toEqual(["thr_pppppppp"]);
    const got: unknown[] = [];
    registerPanelOpener("thr_qqqqqqqq", (p) => (got.push(["other", p]), true), 1001)();
    registerPanelOpener("thr_pppppppp", (p) => (got.push(p), true), 1002)();
    expect(got).toEqual([{ focus: "budget" }]);

    requestPanel(navigate(log), "thr_pppppppp", null, 0);
    registerPanelOpener("thr_pppppppp", (p) => (got.push(p), true), 60_000)();
    expect(got).toHaveLength(1);
  });
});
