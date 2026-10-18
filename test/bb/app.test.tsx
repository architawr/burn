// @vitest-environment jsdom
import { loadPluginApp, type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { rpcContract } from "../../extensions/bb/server.js";
import type { UsageReport } from "../../src/report.js";
import { buildReport } from "../../src/report.js";
import { sampleReport } from "../helpers.js";

const slots: RenderedSlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
});

const THREAD = "thr_aaaaaaaa";
type Answer = { report: UsageReport | null; reportedAt: number | null };

function backend(initial: Answer) {
  let answer = initial;
  let calls = 0;
  return {
    set: (next: Answer) => {
      answer = next;
    },
    calls: () => calls,
    rpc: {
      usage: () => {
        calls++;
        return answer;
      },
    },
  };
}

async function renderChip(server: ReturnType<typeof backend>, settings: Record<string, boolean> = {}) {
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
const NOW: Answer = { report: sampleReport(), reportedAt: Date.now() - 4000 };

describe("Burn chip", () => {
  it("registers one thread header action", async () => {
    const app = await loadPluginApp(() => import("../../extensions/bb/app.js"));
    expect(app.threadHeaderActions).toHaveLength(1);
  });

  it("shows the total as a rounded pill", async () => {
    const slot = await renderChip(backend(NOW));
    const pill = await slot.findByRole("button", { name: /Thread cost \$4\.82/ });
    expect(pill.textContent).toBe("$4.82");
    expect(pill.className).toContain("rounded-full");
  });

  it("reads $0.00 with no report yet and with no calls", async () => {
    const none = await renderChip(backend({ report: null, reportedAt: null }));
    expect((await none.findByRole("button", { name: /Thread cost \$0\.00/ })).textContent).toBe("$0.00");
    fireEvent.pointerMove(await none.findByRole("button", { name: /Thread cost/ }));
    expect((await none.findByRole("tooltip")).textContent).toContain("Waiting for pi to report");
    const zero = await renderChip(backend({ report: buildReport([], undefined), reportedAt: 1 }));
    expect((await zero.findAllByRole("button", { name: /Thread cost \$0\.00/ })).length).toBeGreaterThan(0);
  });

  it("is hidden only when the setting is off", async () => {
    const off = await renderChip(backend(NOW), { chip: false });
    await settle();
    expect(off.queryByRole("button")).toBeNull();
  });

  it("shows tokens when the provider reports no cost", async () => {
    const free = sampleReport({
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      tokens: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    const slot = await renderChip(backend({ report: free, reportedAt: 1 }));
    expect((await slot.findByRole("button", { name: /Thread cost/ })).textContent).toBe("1.2M tok");
  });

  it("shows the breakdown on hover", async () => {
    const slot = await renderChip(backend(NOW));
    fireEvent.pointerMove(await slot.findByRole("button", { name: /Thread cost/ }));
    const card = (await slot.findByRole("tooltip")).textContent ?? "";
    for (const text of ["Input (uncached)", "Cache read", "Cache write", "Output", "p/claude-opus", "p/claude-haiku", "last turn +$0.31", "23 calls", "11.8%", "Reported by pi", "updated "]) {
      expect(card).toContain(text);
    }
  });

  it("refetches on its own thread's signal only, and after a reconnect", async () => {
    const server = backend(NOW);
    const slot = await renderChip(server);
    await slot.findByRole("button", { name: /Thread cost \$4\.82/ });
    expect(server.calls()).toBe(1);

    server.set({ report: sampleReport({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 9.5 } }), reportedAt: 2 });
    await slot.behavior.emitRealtime("usage", { threadId: "thr_other000" });
    expect(server.calls()).toBe(1);
    await slot.behavior.emitRealtime("usage", { threadId: THREAD });
    expect(await slot.findByRole("button", { name: /Thread cost \$9\.50/ })).toBeTruthy();
    expect(server.calls()).toBe(2);

    server.set(NOW);
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(server.calls()).toBe(2);
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(await slot.findByRole("button", { name: /Thread cost \$4\.82/ })).toBeTruthy();
    expect(server.calls()).toBe(3);
  });
});
