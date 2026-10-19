// @vitest-environment jsdom
import { loadPluginApp, type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chipView, STALE_MS } from "../../extensions/bb/chip.js";
import type { rpcContract, UsageAnswer } from "../../extensions/bb/contract.js";
import { buildReport } from "../../src/report.js";
import { sampleReport } from "../helpers.js";
import { answer, backend, THREAD } from "./fixtures.js";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const slots: RenderedSlot[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
});

async function renderChip(server: ReturnType<typeof backend>, settings: Record<string, boolean | number | string> = {}) {
  const app = await loadPluginApp(() => import("../../extensions/bb/app.js"));
  const action = app.threadHeaderActions[0];
  if (!action) throw new Error("the Burn chip is not registered");
  const slot = renderSlot<{ threadId: string; projectId: string; isCompactViewport: boolean }, typeof rpcContract>(
    action,
    { threadId: THREAD, projectId: "proj_1", isCompactViewport: false },
    { rpc: server.rpc, settings },
  );
  slots.push(slot);
  return slot;
}

const settle = async () => act(async () => {});
const chipButton = (slot: RenderedSlot) => within(slot.container).findByRole("button", { name: /Thread cost/ });
const costOf = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total });

const FAMILY = {
  total: 49.97,
  calls: 581,
  estimated: false,
  children: [
    { threadId: "thr_cccccccc", title: "Kevin", cost: 8.92, calls: 105, running: false, model: null, estimated: false },
    { threadId: "thr_dddddddd", title: "Pedro", cost: 14.11, calls: 172, running: false, model: null, estimated: false },
  ],
};

async function openCard(slot: RenderedSlot) {
  fireEvent.click(await chipButton(slot));
  return within(await slot.findByRole("dialog"));
}

describe("chipView", () => {
  const now = Date.UTC(2026, 9, 18, 14, 0, 0);
  const view = (a: UsageAnswer | null, over: Partial<{ fresh: boolean; chipShows: "delta" | "cost" }> = {}) =>
    chipView(a, { now, fresh: false, chipShows: "delta", ...over });

  it("shows the total when idle and the delta only just after a change", () => {
    expect(view(answer())).toMatchObject({ tone: "default", value: "$4.82", suffix: null, running: false });
    expect(view(answer(), { fresh: true }).suffix).toEqual({ kind: "delta", text: "+$0.31" });
    expect(view(answer(), { fresh: true, chipShows: "cost" }).suffix).toBeNull();
  });

  it("waits with a dash, never $0.00, and says why", () => {
    const waiting = view(answer({ report: null, reportedAt: null }));
    expect(waiting).toMatchObject({ tone: "waiting", value: "—", suffix: null });
    expect(waiting.title).toBe("Waiting for the first model call. Burn shows the thread's cost once it has used a model.");
    expect(waiting.label).toBe("Thread cost: waiting for the first model call. Click for details.");
    expect(waiting.title).not.toMatch(/restart|\bpi\b/i);
  });

  it("reads the same whether the figures come from pi's report or its session log", () => {
    expect(view(answer({ source: "log" })).title).toBe(view(answer()).title);
    expect(view(answer({ source: "log" })).title).not.toMatch(/restart|session log/i);
  });

  it("shows the growing delta while pi works", () => {
    expect(view(answer({ report: sampleReport({ running: true }), reportedAt: now - 1000 }))).toMatchObject({
      running: true,
      suffix: { kind: "delta", text: "+$0.31" },
    });
  });

  it("follows the budget: a progress line and the budget in place of the delta, near and over", () => {
    const near = view(answer({ budget: { amount: 6, source: "setting" } }), { fresh: true });
    expect(near).toMatchObject({ tone: "near", suffix: { kind: "budget", text: "/ $6" } });
    expect(near.progress).toBeCloseTo(0.803, 2);
    const over = view(answer({ budget: { amount: 4, source: "thread" } }));
    expect(over).toMatchObject({ tone: "over", suffix: { kind: "budget", text: "/ $4" }, progress: 1 });
    expect(over.label).toContain("$4.82 of $4");
  });

  it("dims a running thread that stopped reporting, with its age", () => {
    const stale = view(answer({ report: sampleReport({ running: true }), reportedAt: now - STALE_MS - 60_000 }));
    expect(stale).toMatchObject({ stale: true, running: false, suffix: { kind: "age", text: "· 6m" } });
    expect(stale.title).toBe("Thread cost $4.82. Burn has seen no new usage for 6m while the thread was working.");
    expect(view(answer({ report: sampleReport({ running: true }), reportedAt: now - 1000 })).title).toBe(
      "Thread cost $4.82, the thread is working. Click for the breakdown.",
    );
  });

  it("never dims a thread read from bb's usage events, whose turn can run for minutes before bb records its usage", () => {
    const long = view(answer({ source: "events", report: sampleReport({ running: true }), reportedAt: now - STALE_MS - 60_000 }));
    expect(long).toMatchObject({ stale: false, running: true });
  });

  it("marks a list-price estimate with a tilde and says so", () => {
    const guess = answer({ report: sampleReport({ estimated: true }) });
    expect(view(guess)).toMatchObject({ value: "~$4.82" });
    expect(view(guess).title).toBe("Thread cost ~$4.82. Click for the breakdown. Estimated at list price.");
    const stale = view(answer({ report: sampleReport({ estimated: true, running: true }), reportedAt: now - STALE_MS - 60_000 }));
    expect(stale.title).toMatch(/while the thread was working\. Estimated at list price\.$/);
    expect(view(answer()).title).not.toContain("Estimated");
  });

  it("shows tokens when the provider reports no cost", () => {
    const free = sampleReport({ cost: costOf(0), tokens: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 } });
    expect(view(answer({ report: free, budget: { amount: 1, source: "setting" } }), { fresh: true })).toMatchObject({
      value: "1.2M",
      unit: "tok",
      tone: "default",
      suffix: null,
      tokenOnly: true,
    });
  });
});

describe("Burn chip", () => {
  it("shows the flame and the total as a rounded pill", async () => {
    const slot = await renderChip(backend());
    const pill = await chipButton(slot);
    expect(pill.getAttribute("aria-label")).toMatch(/^Thread cost \$4\.82\./);
    expect(pill.textContent).toBe("$4.82");
    expect(pill.className).toContain("rounded-full");
    expect(pill.querySelector("[data-burn-flame]")).not.toBeNull();
    const guess = await renderChip(backend(() => answer({ report: sampleReport({ estimated: true }) })));
    expect((await chipButton(guess)).textContent).toBe("~$4.82");
  });

  it("reads a dash with a dashed outline before the first model call, and $0.00 for a report with no calls", async () => {
    const none = await renderChip(backend(() => answer({ report: null, reportedAt: null })));
    const waiting = await none.findByRole("button", { name: /waiting for the first model call/ });
    expect(waiting.textContent).toBe("—");
    expect(waiting.className).toContain("border-dashed");
    expect(waiting.getAttribute("title")).not.toMatch(/restart/i);
    const zero = await renderChip(backend(() => answer({ report: buildReport([], undefined) })));
    expect((await zero.findAllByRole("button", { name: /Thread cost \$0\.00/ })).length).toBeGreaterThan(0);
  });

  it("marks a running thread for the flicker and the shimmer", async () => {
    const slot = await renderChip(backend(() => answer({ report: sampleReport({ running: true }), reportedAt: Date.now() })));
    const pill = await chipButton(slot);
    expect(pill.hasAttribute("data-running")).toBe(true);
    expect(pill.querySelector("[data-burn-shimmer]")).not.toBeNull();
    expect(pill.textContent).toBe("$4.82+$0.31");
  });

  it("shows the budget tone and amount near and over budget", async () => {
    const near = await renderChip(backend(() => answer({ budget: { amount: 6, source: "setting" } })));
    const pill = await chipButton(near);
    expect(pill.dataset.tone).toBe("near");
    expect(pill.className).toContain("bg-warning/15");
    expect(pill.textContent).toBe("$4.82/ $6");
    const over = await renderChip(backend(() => answer({ budget: { amount: 4, source: "thread" } })));
    expect((await chipButton(over)).className).toContain("bg-destructive/15");
  });

  it("slides the delta in when a report changes the total, unless the chip shows cost only", async () => {
    let total = 4.82;
    const server = backend(() => answer({ report: sampleReport({ cost: costOf(total) }) }));
    const slot = await renderChip(server);
    expect((await chipButton(slot)).textContent).toBe("$4.82");
    total = 5.13;
    await slot.behavior.emitRealtime("usage", { threadId: THREAD });
    await vi.waitFor(async () => expect((await chipButton(slot)).textContent).toBe("$5.13+$0.31"));

    const quiet = await renderChip(backend(() => answer({ report: sampleReport({ cost: costOf(total) }) })), { chipShows: "cost" });
    expect((await chipButton(quiet)).textContent).toBe("$5.13");
    total = 6;
    await quiet.behavior.emitRealtime("usage", { threadId: THREAD });
    await vi.waitFor(async () => expect((await chipButton(quiet)).getAttribute("aria-label")).toContain("$6.00"));
    expect((await chipButton(quiet)).textContent).toBe("$6.00");
  });

  it("is hidden only when the setting is off", async () => {
    const off = await renderChip(backend(), { chip: false });
    await settle();
    expect(off.queryByRole("button")).toBeNull();
  });

  it("refetches on its own thread's signal only, and after a reconnect", async () => {
    let total = 4.82;
    const server = backend(() => answer({ report: sampleReport({ cost: costOf(total) }) }));
    const slot = await renderChip(server);
    await slot.findByRole("button", { name: /Thread cost \$4\.82/ });
    expect(server.callsTo("usage")).toHaveLength(1);

    total = 9.5;
    await slot.behavior.emitRealtime("usage", { threadId: "thr_other000" });
    expect(server.callsTo("usage")).toHaveLength(1);
    await slot.behavior.emitRealtime("usage", { threadId: THREAD });
    expect(await slot.findByRole("button", { name: /Thread cost \$9\.50/ })).toBeTruthy();
    expect(server.callsTo("usage")).toHaveLength(2);

    total = 4.82;
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(server.callsTo("usage")).toHaveLength(2);
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(await slot.findByRole("button", { name: /Thread cost \$4\.82/ })).toBeTruthy();
    expect(server.callsTo("usage")).toHaveLength(3);
  });
});

describe("the chip's popover", () => {
  it("opens on click with every section, and closes on Escape", async () => {
    const slot = await renderChip(backend(() => answer({ budget: { amount: 10, source: "setting" } })));
    const card = await openCard(slot);
    const text = card.getByTestId("burn-card").textContent ?? "";
    for (const part of [
      "Burn",
      "updated 12s ago",
      "$4.82",
      "+$0.31 last turn",
      "23 calls · 4 prompts · 1h 12m",
      "48% of the $10 thread budget",
      "$5.18 left",
      "Where it went",
      "cache hit 89%",
      "Input$2.22",
      "Cache read$1.96",
      "Per call",
      "Models",
      "claude-opus18 calls",
      "Open details",
      "Set budget…",
      "Copy summary",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).not.toMatch(/saved|per hour|\/ ?hour/);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("adds the child threads' cost, and says when the figures last changed wherever they come from", async () => {
    const slot = await renderChip(backend(() => answer({ source: "log", family: FAMILY })));
    const card = await openCard(slot);
    expect(card.getByTestId("with-children").textContent).toBe("$49.97 with 2 child threads");
    expect(card.getByText(/^updated \d+s ago$/)).toBeTruthy();
    expect(card.queryByText(/from pi's log|restart/i)).toBeNull();
    expect(card.queryByTestId("estimated")).toBeNull();
  });

  it("marks a list-price estimate in the total and the family line, and says why", async () => {
    const slot = await renderChip(backend(() => answer({ report: sampleReport({ estimated: true }), family: { ...FAMILY, estimated: true } })));
    const card = await openCard(slot);
    expect(card.getByTestId("burn-card").textContent).toContain("~$4.82");
    expect(card.getByTestId("with-children").textContent).toBe("~$49.97 with 2 child threads");
    expect(card.getByTestId("estimated").textContent).toBe("~ Estimated at list price: this harness records no cost.");
  });

  it("refetches only on signals, never on a timer, even for figures from a session log", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const server = backend(() => answer({ source: "log" }));
    const slot = await renderChip(server);
    await chipButton(slot);
    await openCard(slot);
    expect(interval.mock.calls.map(([, ms]) => ms)).not.toContain(60_000);
    expect(server.callsTo("usage")).toHaveLength(1);
    interval.mockRestore();
  });

  it("explains the wait before the first model call", async () => {
    const slot = await renderChip(backend(() => answer({ report: null, reportedAt: null })));
    fireEvent.click(await slot.findByRole("button", { name: /waiting for the first model call/ }));
    const card = within(await slot.findByRole("dialog"));
    expect(card.getByTestId("waiting").textContent).toContain("Waiting for the first model call");
    expect(card.getByTestId("waiting").textContent).toContain(
      "from pi's session log in pi threads, and from the usage bb records for other harnesses. Claude Code reports as each turn ends.",
    );
    expect(card.getByTestId("waiting").textContent).not.toMatch(/restart/i);
  });

  it("shows the call under the pointer in the per-call chart", async () => {
    const slot = await renderChip(backend());
    const card = await openCard(slot);
    const bar = card.getByTestId("per-call").querySelector('[data-call="1"]');
    if (!bar) throw new Error("no hit area for the second call");
    fireEvent.mouseEnter(bar);
    expect(card.getByRole("status").textContent).toBe("Turn 2 · call 3/3 · $0.62 · total $4.51");
  });

  it("notes a run Burn stopped at the budget", async () => {
    const stoppedAt = new Date(2026, 9, 18, 13, 2).getTime();
    const slot = await renderChip(backend(() => answer({ report: sampleReport({ stoppedAt }), budget: { amount: 10, source: "thread" } })));
    const card = await openCard(slot);
    expect(card.getByRole("note").textContent).toBe("Burn stopped a run at the $10 budget at 13:02. Send another prompt to keep going.");
  });

  it("edits the budget inline: validates with parseBudget, saves, uses the default and clears", async () => {
    const server = backend();
    const slot = await renderChip(server, { threadBudget: 10 });
    const card = await openCard(slot);
    expect(card.getByText("No budget")).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Set budget" }));
    const input = card.getByRole("textbox", { name: "Budget in dollars" });
    expect(document.activeElement).toBe(input);
    expect(card.getByTestId("budget-editor").textContent).toContain("Use default follows the Thread budget setting ($10)");

    fireEvent.change(input, { target: { value: "lots" } });
    fireEvent.click(card.getByRole("button", { name: "Save" }));
    expect(card.getByRole("alert").textContent).toBe("Enter dollars, such as 10 or 7.50.");
    expect(server.callsTo("setBudget")).toEqual([]);

    const closed = () => vi.waitFor(() => expect(card.queryByTestId("budget-editor")).toBeNull());
    fireEvent.change(input, { target: { value: "$7.50" } });
    fireEvent.click(card.getByRole("button", { name: "Save" }));
    await closed();
    fireEvent.click(card.getByRole("button", { name: "Set budget…" }));
    fireEvent.click(card.getByRole("button", { name: "Use default" }));
    await closed();
    fireEvent.click(card.getByRole("button", { name: "Set budget…" }));
    fireEvent.click(card.getByRole("button", { name: "Clear" }));
    await closed();
    expect(server.callsTo("setBudget").map((c) => (c.input as { budget: unknown }).budget)).toEqual([7.5, "default", null]);
  });

  it("opens the Burn tab and copies the summary", async () => {
    const slot = await renderChip(backend());
    let card = await openCard(slot);
    const actions = card.getByRole("toolbar", { name: "Burn actions" });
    expect([...actions.querySelectorAll("button")].map((b) => [b.textContent, b.querySelector("svg") !== null])).toEqual([
      ["Open details", true],
      ["Set budget…", true],
      ["Copy summary", true],
    ]);
    fireEvent.click(card.getByRole("button", { name: "Copy summary" }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied the cost summary"));
    await vi.waitFor(() => expect(card.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(slot.inspection.experimental_clipboardWrites[0]?.text).toContain("### Cost of “burn UX polish”");

    fireEvent.click(card.getByRole("button", { name: "Open details" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "openThreadPanel", options: { actionId: "burn" } });
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    card = await openCard(slot);
    expect(card.getByText("Open details")).toBeTruthy();
  });
});
