// @vitest-environment jsdom
import { type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpendOutput, SpendRange, SpendZone, spendMethods } from "../../extensions/bb/spend/contract.js";
import { localDays } from "../../extensions/bb/spend/days.js";
import { REFETCH_DEBOUNCE_MS, SpendPage } from "../../extensions/bb/spend/page.js";

const slots: RenderedSlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
  localStorage.clear();
});

const NOW = new Date(2026, 9, 18, 15).getTime();

function output(range: SpendRange = "7d", over: Partial<SpendOutput> = {}): SpendOutput {
  const count = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const days = localDays(NOW, count).map((day, i) => ({
    day,
    cost: i === count - 1 ? 23.6 : 10,
    models: [
      { key: "anthropic/claude-opus-4-5", cost: i === count - 1 ? 15.8 : 7 },
      { key: "anthropic/claude-sonnet-4-5", cost: i === count - 1 ? 7.8 : 3 },
    ],
  }));
  return {
    range,
    tz: "local",
    days,
    total: 97.4,
    previousTotal: 82.54,
    threadCount: 31,
    overBudgetCount: 2,
    medianThreadCost: 1.84,
    perCall: 0.19,
    cacheHitPct: 87.2,
    threads: [
      {
        threadId: "thr_aaaaaa01",
        title: "Cortex in bb: memory marker and Memory tab",
        projectName: "cortex",
        model: "claude-opus-4-5",
        childCount: 0,
        calls: 312,
        rangeCost: 14.2,
        total: 22.75,
        budget: null,
        running: false,
        estimated: false,
      },
      {
        threadId: "thr_aaaaaa02",
        title: "bb config across machines",
        projectName: "shell",
        model: "claude-opus-4-5",
        childCount: 0,
        calls: 97,
        rangeCost: 12.4,
        total: 12.4,
        budget: 10,
        running: false,
        estimated: false,
      },
      {
        threadId: "thr_aaaaaa03",
        title: "burn UX polish",
        projectName: "burn",
        model: "claude-opus-4-5",
        childCount: 2,
        calls: 46,
        rangeCost: 6.64,
        total: 6.64,
        budget: 10,
        running: true,
        estimated: false,
      },
    ],
    projects: [
      { projectId: "proj_m", name: "bb-marketplace", cost: 31.2 },
      { projectId: "proj_c", name: "cortex", cost: 24.6 },
    ],
    models: [
      { key: "anthropic/claude-opus-4-5", cost: 57.8 },
      { key: "anthropic/claude-sonnet-4-5", cost: 25.8 },
    ],
    projectOptions: [
      { projectId: "proj_c", name: "cortex" },
      { projectId: "proj_m", name: "bb-marketplace" },
    ],
    dailyBudget: 50,
    reportedThreads: 40,
    estimated: false,
    ...over,
  };
}

type Input = { range: SpendRange; projectId: string | null; tz?: SpendZone };

function backend(answer: (input: Input) => SpendOutput | Promise<SpendOutput>) {
  const inputs: Input[] = [];
  return {
    inputs,
    rpc: {
      spend: (input: Input) => {
        inputs.push(input);
        return answer(input);
      },
    },
  };
}

function render(server: ReturnType<typeof backend>, subPath = "") {
  const slot = renderSlot<{ subPath: string }, typeof spendMethods>({ component: SpendPage }, { subPath }, { rpc: server.rpc });
  slots.push(slot);
  return slot;
}

describe("Spend page", () => {
  it("shows the KPIs, the daily chart with its legend and the costliest threads", async () => {
    const slot = render(backend((input) => output(input.range)));
    expect(await slot.findByText("$97.40")).toBeTruthy();
    const text = slot.container.textContent ?? "";
    for (const piece of ["Spent", "▲ 18%", "vs previous 7 days", "Threads", "31", "2 over budget", "Median thread", "$1.84", "$0.19 per call", "Cache hit rate", "87%"]) {
      expect(text).toContain(piece);
    }
    expect(text).not.toContain("saved");

    const models = within(slot.getByRole("list", { name: "Models" }));
    expect(models.getByText("claude-opus-4-5")).toBeTruthy();
    expect(models.getByText("claude-sonnet-4-5")).toBeTruthy();

    const days = within(slot.getByRole("list", { name: "Spend per day" })).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(slot.getByText("Daily budget $50")).toBeTruthy();
    fireEvent.mouseEnter(days[6] as HTMLElement);
    const tip = (await slot.findByRole("tooltip")).textContent ?? "";
    expect(tip).toContain("$23.60");
    expect(tip).toContain("claude-opus-4-5$15.80");
    expect(tip).toContain("claude-sonnet-4-5$7.80");

    const rows = slot.getAllByTestId("spend-thread");
    expect(rows.map((r) => r.querySelector("button")?.textContent)).toEqual([
      "Cortex in bb: memory marker and Memory tab",
      "bb config across machines",
      "burn UX polish",
    ]);
    expect(rows[0]?.textContent).toContain("cortex · claude-opus-4-5");
    expect(rows[0]?.textContent).toContain("$14.20");
    expect(rows[0]?.textContent).toContain("$22.75");
    expect(rows[1]?.textContent).toContain("over $10");
    expect(rows[2]?.textContent).toContain("running");
    expect(rows[2]?.textContent).not.toContain("over $10");
    expect(rows[2]?.textContent).toContain("2 child threads");
    expect(slot.getByText("Last 7 days")).toBeTruthy();

    expect(within(slot.getByRole("region", { name: "By project" })).getByText("bb-marketplace")).toBeTruthy();
    expect(within(slot.getByRole("region", { name: "By model" })).getByText("$57.80")).toBeTruthy();
    expect(slot.queryByText(/list-price estimates/)).toBeNull();
  });

  it("marks list-price estimates in the Spent figure and the thread rows, and says so", async () => {
    const base = output("7d");
    const slot = render(backend(() => ({ ...base, estimated: true, threads: base.threads.map((t, i) => ({ ...t, estimated: i === 0 })) })));
    expect(await slot.findByText("~$97.40")).toBeTruthy();
    expect(slot.getByText("~ includes list-price estimates for harnesses that record no cost.")).toBeTruthy();
    const rows = slot.getAllByTestId("spend-thread");
    expect(rows[0]?.textContent).toContain("~$14.20");
    expect(rows[0]?.textContent).toContain("~$22.75");
    expect(rows[1]?.textContent).not.toContain("~");
  });

  it("opens a thread from its row", async () => {
    const slot = render(backend((input) => output(input.range)));
    fireEvent.click(await slot.findByRole("button", { name: "bb config across machines" }));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_aaaaaa02" }]);
  });

  it("asks again for another range and project", async () => {
    const server = backend((input) => output(input.range));
    const slot = render(server);
    await slot.findByText("$97.40");
    fireEvent.click(slot.getByRole("button", { name: "30 days" }));
    await waitFor(() => expect(within(slot.getByRole("list", { name: "Spend per day" })).getAllByRole("listitem")).toHaveLength(30));
    expect(slot.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.getByText("Last 30 days")).toBeTruthy();

    fireEvent.change(slot.getByRole("combobox", { name: "Project" }), { target: { value: "proj_c" } });
    await waitFor(() => expect(server.inputs.at(-1)).toEqual({ range: "30d", projectId: "proj_c", tz: "local" }));

    fireEvent.click(slot.getByRole("button", { name: "Today" }));
    expect(await slot.findByRole("img", { name: "Today by model: $97.40" })).toBeTruthy();
    expect(server.inputs.at(-1)).toEqual({ range: "today", projectId: "proj_c", tz: "local" });
    expect(server.inputs[0]).toEqual({ range: "7d", projectId: null, tz: "local" });
  });

  it("starts on the range named in the panel path", async () => {
    const server = backend((input) => output(input.range));
    render(server, "30d");
    await waitFor(() => expect(server.inputs[0]).toEqual({ range: "30d", projectId: null, tz: "local" }));
  });

  it("switches between local and UTC days, remembers the choice and labels the figures", async () => {
    const server = backend((input) => output(input.range, { tz: input.tz ?? "local" }));
    const slot = render(server);
    await slot.findByText("$97.40");
    const group = within(slot.getByRole("group", { name: "Days" }));
    expect(group.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.queryByText(/\(UTC\)/)).toBeNull();

    fireEvent.click(group.getByRole("button", { name: "UTC" }));
    await waitFor(() => expect(server.inputs.at(-1)).toEqual({ range: "7d", projectId: null, tz: "utc" }));
    expect(await slot.findByText("Spent (UTC)")).toBeTruthy();
    expect(slot.getByText("Per day (UTC)")).toBeTruthy();
    expect(group.getByRole("button", { name: "UTC" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("burn.spend.tz")).toBe("utc");

    slot.lifecycle.unmount();
    const again = backend((input) => output(input.range, { tz: input.tz ?? "local" }));
    render(again);
    await waitFor(() => expect(again.inputs[0]).toEqual({ range: "7d", projectId: null, tz: "utc" }));
  });

  it("shows the empty state when no thread has reported", async () => {
    const slot = render(backend(() => output("7d", { reportedThreads: 0, threads: [], projects: [], models: [], projectOptions: [] })));
    expect(
      await slot.findByText("No thread has spent anything yet. Burn counts a thread from its first model call."),
    ).toBeTruthy();
    expect(slot.queryByText("Spent")).toBeNull();
  });

  it("says so when a range has no spend", async () => {
    const slot = render(backend(() => output("7d", { threads: [], projects: [], models: [], total: 0, previousTotal: 0, threadCount: 0 })));
    expect(await slot.findByText("No thread spent anything in this period.")).toBeTruthy();
    expect(slot.container.textContent).toContain("no spend in the previous 7 days");
  });

  it("shows loading, then an error with a retry", async () => {
    let fail = true;
    const slot = render(
      backend((input) => {
        if (fail) throw new Error("bb is restarting");
        return output(input.range);
      }),
    );
    expect(slot.getByText("Loading spend…")).toBeTruthy();
    expect(await slot.findByText("Could not load spend: bb is restarting")).toBeTruthy();
    fail = false;
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    expect(await slot.findByText("$97.40")).toBeTruthy();
  });

  it("refetches once after a burst of usage signals, and after a reconnect", async () => {
    let total = 97.4;
    const server = backend((input) => output(input.range, { total }));
    const slot = render(server);
    await slot.findByText("$97.40");
    expect(server.inputs).toHaveLength(1);

    total = 101.25;
    await slot.behavior.emitRealtime("usage", { threadId: "thr_aaaaaa01" });
    await slot.behavior.emitRealtime("usage", { threadId: "thr_aaaaaa02" });
    await slot.behavior.emitRealtime("usage", { threadId: "thr_aaaaaa03" });
    expect(server.inputs).toHaveLength(1);
    expect(await slot.findByText("$101.25", undefined, { timeout: REFETCH_DEBOUNCE_MS + 1500 })).toBeTruthy();
    expect(server.inputs).toHaveLength(2);

    total = 5;
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(await slot.findByText("$5.00")).toBeTruthy();
    expect(server.inputs).toHaveLength(3);
    await act(async () => {});
  });
});
