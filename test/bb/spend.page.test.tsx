// @vitest-environment jsdom
import { type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SPEND_PANELS, type SpendMetric, type SpendOutput, type SpendPanel, type SpendRange, type SpendZone, type spendMethods } from "../../extensions/bb/spend/contract.js";
import { localDays } from "../../extensions/bb/spend/days.js";
import { REFETCH_DEBOUNCE_MS, SpendPage } from "../../extensions/bb/spend/page.js";
import { PANELS } from "../../extensions/bb/spend/panels.js";

const slots: RenderedSlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
  localStorage.clear();
});

const NOW = new Date(2026, 9, 18, 15).getTime();

function output(range: SpendRange = "7d", over: Partial<SpendOutput> = {}): SpendOutput {
  const count = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const last = (i: number) => i === count - 1;
  const days = localDays(NOW, count).map((day, i) => ({
    day,
    cost: last(i) ? 23.6 : 10,
    tokens: last(i) ? 52_000_000 : 20_000_000,
    calls: last(i) ? 410 : 150,
    models: [
      { key: "anthropic/claude-opus-4-5", cost: last(i) ? 15.8 : 7, tokens: last(i) ? 30_000_000 : 14_000_000, calls: last(i) ? 200 : 100 },
      { key: "anthropic/claude-sonnet-4-5", cost: last(i) ? 7.8 : 3, tokens: last(i) ? 22_000_000 : 6_000_000, calls: last(i) ? 210 : 50 },
    ],
  }));
  const activity = localDays(NOW, count).map((day, i) => ({ day, hours: Array.from({ length: 24 }, (_, h) => (last(i) && h === 11 ? 35.89 : h === 9 ? 2 : 0)) }));
  return {
    range,
    tz: "local",
    metric: "cost",
    days,
    total: 97.4,
    previousTotal: 82.54,
    tokens: 3_640_000_000,
    previousTokens: 3_000_000_000,
    calls: 14_942,
    prompts: 640,
    runningCount: 3,
    threadCount: 31,
    overBudgetCount: 2,
    medianThreadCost: 1.84,
    perCall: 0.19,
    cacheHitPct: 87.2,
    mix: {
      tokens: { input: 1_000_000, output: 20_000_000, cacheRead: 3_500_000_000, cacheWrite: 119_000_000, reasoning: 12_600_000 },
      costs: { input: 0.04, output: 18.2, cacheRead: 46.1, cacheWrite: 33.06 },
    },
    callTime: { buckets: [43, 408, 3034, 5215, 3339, 1693, 780, 322, 107], timed: 14_941, failed: 82, aborted: 10, p50: 6758, p90: 27_379 },
    activity,
    threads: [
      {
        threadId: "thr_aaaaaa01",
        harness: "pi",
        tokens: 1_000_000,
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
        harness: "pi",
        tokens: 1_000_000,
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
        harness: "pi",
        tokens: 1_000_000,
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
      { projectId: "proj_m", name: "bb-marketplace", cost: 31.2, tokens: 1_200_000_000, calls: 5000 },
      { projectId: "proj_c", name: "cortex", cost: 24.6, tokens: 900_000_000, calls: 4000 },
    ],
    models: [
      { key: "anthropic/claude-opus-4-5", cost: 57.8, tokens: 2_000_000_000, calls: 9000 },
      { key: "anthropic/claude-sonnet-4-5", cost: 25.8, tokens: 1_000_000_000, calls: 5000 },
    ],
    modelStats: [
      {
        key: "anthropic/claude-opus-4-5",
        harness: "pi",
        cost: 57.8,
        tokens: 2_000_000_000,
        calls: 9000,
        cacheHitPct: 97,
        avgCallMs: 15_080,
        outputPerSec: 62,
        failedPct: 0.55,
        estimated: false,
      },
      {
        key: "codex/gpt-5.6-sol",
        harness: "Codex",
        cost: 12.3,
        tokens: 640_000_000,
        calls: 942,
        cacheHitPct: 90,
        avgCallMs: null,
        outputPerSec: null,
        failedPct: null,
        estimated: true,
      },
    ],
    harnesses: [
      { providerId: "pi", name: "pi", cost: 85.1, tokens: 3_000_000_000, calls: 14_000, estimated: false },
      { providerId: "codex", name: "Codex", cost: 12.3, tokens: 640_000_000, calls: 942, estimated: true },
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

type Input = { range: SpendRange; projectId: string | null; tz?: SpendZone; metric?: SpendMetric };

/** The spend rpc answered by `answer`, and the hidden panels kept in memory as the plugin keeps them. */
function backend(answer: (input: Input) => SpendOutput | Promise<SpendOutput>, hidden: SpendPanel[] = []) {
  const inputs: Input[] = [];
  const saved: SpendPanel[][] = [];
  let stored = hidden;
  return {
    inputs,
    saved,
    rpc: {
      spend: (input: Input) => {
        inputs.push(input);
        return answer(input);
      },
      spendPanels: () => ({ hidden: stored }),
      setSpendPanels: (input: { hidden: SpendPanel[] }) => {
        saved.push(input.hidden);
        stored = input.hidden;
        return { hidden: stored };
      },
    },
  };
}

function render(server: ReturnType<typeof backend>, subPath = "", settings: Record<string, number> = {}) {
  const slot = renderSlot<{ subPath: string }, typeof spendMethods>({ component: SpendPage }, { subPath }, { rpc: server.rpc, settings });
  slots.push(slot);
  return slot;
}

describe("Spend page", () => {
  it("shows the KPIs, the daily chart with its legend and the costliest threads", async () => {
    const slot = render(backend((input) => output(input.range)));
    expect(await slot.findByText("$97.40")).toBeTruthy();
    const text = slot.container.textContent ?? "";
    for (const piece of ["Spent", "▲ 18%", "vs previous 7 days", "Threads", "31", "3 running · 2 over budget", "Median thread", "$1.84", "$0.19 per call", "Cache hit rate", "87%"]) {
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
    expect(within(slot.getByRole("region", { name: "By harness" })).getByText("~$12.30")).toBeTruthy();
    expect(slot.queryByRole("region", { name: "By model" })).toBeNull();
    expect(slot.queryByText(/estimates from list prices/)).toBeNull();
    expect(slot.queryByTestId("discounted")).toBeNull();
  });

  it("marks list-price estimates in the Spent figure and the thread rows, and says so", async () => {
    const base = output("7d");
    const slot = render(backend(() => ({ ...base, estimated: true, threads: base.threads.map((t, i) => ({ ...t, estimated: i === 0 })) })));
    expect(await slot.findByText("~$97.40")).toBeTruthy();
    expect(slot.getByText("~ includes estimates from list prices for harnesses that record no cost.")).toBeTruthy();
    const rows = slot.getAllByTestId("spend-thread");
    expect(rows[0]?.textContent).toContain("~$14.20");
    expect(rows[0]?.textContent).toContain("~$22.75");
    expect(rows[1]?.textContent).not.toContain("~");
  });

  it("says when its costs include discounts", async () => {
    const slot = render(backend((input) => output(input.range)), "", { discount: 16 });
    expect((await slot.findByTestId("discounted")).textContent).toBe("Costs include the discounts in Burn's settings.");
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
    await waitFor(() => expect(server.inputs.at(-1)).toEqual({ range: "30d", projectId: "proj_c", tz: "local", metric: "cost" }));

    fireEvent.click(slot.getByRole("button", { name: "Today" }));
    expect(await slot.findByRole("img", { name: "Today by model: $97.40" })).toBeTruthy();
    expect(server.inputs.at(-1)).toEqual({ range: "today", projectId: "proj_c", tz: "local", metric: "cost" });
    expect(server.inputs[0]).toEqual({ range: "7d", projectId: null, tz: "local", metric: "cost" });
  });

  it("starts on the range named in the panel path", async () => {
    const server = backend((input) => output(input.range));
    render(server, "30d");
    await waitFor(() => expect(server.inputs[0]).toEqual({ range: "30d", projectId: null, tz: "local", metric: "cost" }));
  });

  it("switches between local and UTC days, remembers the choice and labels the figures", async () => {
    const server = backend((input) => output(input.range, { tz: input.tz ?? "local" }));
    const slot = render(server);
    await slot.findByText("$97.40");
    const group = within(slot.getByRole("group", { name: "Days" }));
    expect(group.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.queryByText(/\(UTC\)/)).toBeNull();

    fireEvent.click(group.getByRole("button", { name: "UTC" }));
    await waitFor(() => expect(server.inputs.at(-1)).toEqual({ range: "7d", projectId: null, tz: "utc", metric: "cost" }));
    expect(await slot.findByText("Spent (UTC)")).toBeTruthy();
    expect(slot.getByText("Per day (UTC)")).toBeTruthy();
    expect(group.getByRole("button", { name: "UTC" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("burn.spend.tz")).toBe("utc");

    slot.lifecycle.unmount();
    const again = backend((input) => output(input.range, { tz: input.tz ?? "local" }));
    render(again);
    await waitFor(() => expect(again.inputs[0]).toEqual({ range: "7d", projectId: null, tz: "utc", metric: "cost" }));
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

  it("keeps the chosen days when a usage signal from before the switch refetches", async () => {
    const server = backend((input) => {
      const tz = input.tz ?? "local";
      return output(input.range, { tz, total: tz === "utc" ? 88.1 : 97.4 });
    });
    const slot = render(server);
    await slot.findByText("$97.40");

    await slot.behavior.emitRealtime("usage", { threadId: "thr_aaaaaa01" });
    fireEvent.click(within(slot.getByRole("group", { name: "Days" })).getByRole("button", { name: "UTC" }));
    expect(await slot.findByText("$88.10")).toBeTruthy();

    await waitFor(() => expect(server.inputs).toHaveLength(3), { timeout: REFETCH_DEBOUNCE_MS + 1500 });
    await act(async () => {});
    expect(server.inputs.at(-1)).toEqual({ range: "7d", projectId: null, tz: "utc", metric: "cost" });
    expect(slot.getByText("$88.10")).toBeTruthy();
    expect(slot.getByText("Spent (UTC)")).toBeTruthy();
  });

  it("ranks by tokens when asked, retitling the table and the chart", async () => {
    const server = backend((input) => output(input.range, { metric: input.metric ?? "cost" }));
    const slot = render(server);
    await slot.findByText("$97.40");
    fireEvent.click(within(slot.getByRole("group", { name: "Show" })).getByRole("button", { name: "Tokens" }));
    await waitFor(() => expect(server.inputs.at(-1)).toEqual({ range: "7d", projectId: null, tz: "local", metric: "tokens" }));
    expect(await slot.findByText("Most tokens")).toBeTruthy();
    const days = within(slot.getByRole("list", { name: "Tokens per day" })).getAllByRole("listitem");
    expect(days[6]?.getAttribute("aria-label")).toContain("52M");
    expect(slot.getByText("Per day · tokens")).toBeTruthy();
    expect(slot.queryByText("Daily budget $50")).toBeNull();
    expect(within(slot.getByRole("region", { name: "By project" })).getByText("1.20B")).toBeTruthy();
    expect(slot.getByText("Activity by hour · tokens")).toBeTruthy();
  });

  it("shows the usage cards, token mix, call time, busiest hour and Models table", async () => {
    const slot = render(backend((input) => output(input.range)));
    await slot.findByText("$97.40");
    const text = slot.container.textContent ?? "";
    for (const piece of ["Tokens", "3.64B", "▲ 21%", "14,942", "640 prompts", "Median call", "6.8s", "p90 27s", "Failed calls", "0.5% of timed calls"]) {
      expect(text).toContain(piece);
    }
    const mix = within(slot.getByRole("region", { name: "Token mix" }));
    expect(mix.getByText("Cache read")).toBeTruthy();
    expect(mix.getByText("3.50B")).toBeTruthy();
    expect(mix.getByText("↳ reasoning")).toBeTruthy();
    const time = within(slot.getByRole("region", { name: "Call time" }));
    expect(time.getAllByRole("listitem").map((b) => b.getAttribute("aria-label")?.split(":")[0])).toEqual(["<1s", "1–2s", "2–4s", "4–8s", "8–16s", "16–32s", "32–64s", "1–2m", ">2m"]);
    expect(time.getByText("82")).toBeTruthy();
    expect(slot.getByRole("img", { name: /busiest .* 11:00, \$35\.89/ })).toBeTruthy();
    expect(slot.getByText(/^busiest: /).textContent).toMatch(/^busiest: \w{3} 11:00, \$35\.89$/);
    const models = slot.getAllByTestId("spend-model");
    expect(models[0]?.textContent).toContain("claude-opus-4-5");
    expect(models[0]?.textContent).toContain("15s");
    expect(models[1]?.textContent).toContain("Codex");
    expect(models[1]?.textContent).toContain("~$12.30");
    expect(within(models[1] as HTMLElement).getAllByText("—")).toHaveLength(3);
    expect(slot.getByText("Cache hit, Avg call, Output/s and Failed cover the whole life of the threads in range.")).toBeTruthy();
  });

  it("names the provider of models that share a name, and only of those", async () => {
    const row = (key: string) => ({ key, harness: "pi", cost: 1, tokens: 1000, calls: 1, cacheHitPct: null, avgCallMs: null, outputPerSec: null, failedPct: null, estimated: false });
    const modelStats = [row("anthropic/claude-sonnet-5-5"), row("anthropic-1m/claude-sonnet-5-5"), row("openai/gpt-6-sol")];
    const slot = render(backend((input) => output(input.range, { modelStats })));
    await slot.findByText("$97.40");
    const names = slot.getAllByTestId("spend-model").map((r) => r.querySelector("td")?.textContent);
    expect(names).toEqual(["claude-sonnet-5-5anthropic", "claude-sonnet-5-5anthropic-1m", "gpt-6-sol"]);
  });

  it("says when no call was timed", async () => {
    const callTime = { buckets: new Array(9).fill(0), timed: 0, failed: 0, aborted: 0, p50: null, p90: null };
    const slot = render(backend((input) => output(input.range, { callTime })));
    expect(await slot.findByText("No timed calls in this period.")).toBeTruthy();
    expect(slot.container.textContent).toContain("no timed calls");
  });

  it("hides a panel from the Panels menu, keeps the choice and leaves its neighbour the row", async () => {
    const server = backend((input) => output(input.range));
    const slot = render(server);
    await slot.findByText("$97.40");
    expect(slot.getByRole("region", { name: "Call time" }).closest(".grid")?.className).toContain("md:grid-cols-2");
    fireEvent.click(slot.getByRole("button", { name: "Panels" }));
    const menu = within(await slot.findByRole("dialog"));
    expect(menu.getByText("Show on this page")).toBeTruthy();
    expect(menu.getByText("Kept by Burn for every bb window")).toBeTruthy();
    expect((menu.getByRole("button", { name: "Show all" }) as HTMLButtonElement).disabled).toBe(true);
    const mix = menu.getByRole("switch", { name: "Token mix" }) as HTMLInputElement;
    expect(mix.checked).toBe(true);
    fireEvent.click(mix);
    await waitFor(() => expect(slot.queryByRole("region", { name: "Token mix" })).toBeNull());
    expect(server.saved).toEqual([["mix"]]);
    expect(slot.getByRole("region", { name: "Call time" }).closest(".grid")?.className).not.toContain("md:grid-cols-2");
    expect(slot.getByRole("button", { name: "Panels, 1 hidden" })).toBeTruthy();
    expect((menu.getByRole("switch", { name: "Token mix" }) as HTMLInputElement).checked).toBe(false);
  });

  it("hides a panel from its own hide button", async () => {
    const server = backend((input) => output(input.range));
    const slot = render(server);
    await slot.findByText("$97.40");
    fireEvent.click(slot.getByRole("button", { name: "Hide Token mix" }));
    await waitFor(() => expect(slot.queryByRole("region", { name: "Token mix" })).toBeNull());
    expect(server.saved).toEqual([["mix"]]);
    fireEvent.click(slot.getByRole("button", { name: "Hide Threads" }));
    await waitFor(() => expect(slot.queryAllByTestId("spend-thread")).toHaveLength(0));
    expect(server.saved.at(-1)).toEqual(["mix", "threads"]);
    expect(slot.queryByRole("button", { name: "Hide Usage cards" })).toBeNull();
  });

  it("says so when every panel is hidden, and shows them all again", async () => {
    const server = backend((input) => output(input.range), [...SPEND_PANELS]);
    const slot = render(server);
    expect(await slot.findByText("Every panel is hidden.", { exact: false })).toBeTruthy();
    expect(slot.getByText("$97.40")).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Per day" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Show all panels" }));
    expect(await slot.findByRole("region", { name: "Per day" })).toBeTruthy();
    expect(slot.queryByText("Every panel is hidden.", { exact: false })).toBeNull();
    expect(server.saved).toEqual([[]]);
  });

  it("applies the stored hidden panels on first paint", async () => {
    const slot = render(backend((input) => output(input.range), ["chart", "models"]));
    await slot.findByText("$97.40");
    expect(slot.queryByRole("region", { name: "Per day" })).toBeNull();
    expect(slot.queryByRole("region", { name: "Models" })).toBeNull();
    expect(slot.getByRole("region", { name: "Token mix" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Panels, 2 hidden" })).toBeTruthy();
  });

  it("lists every panel the plugin keeps, in page order", () => {
    expect(PANELS.map((p) => p.id)).toEqual([...SPEND_PANELS]);
  });
});
