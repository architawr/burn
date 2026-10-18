import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import plugin from "../../extensions/bb/server.js";
import { buildReport } from "../../src/report.js";
import { assistant, sampleReport, user } from "../helpers.js";

const THREAD = "thr_aaaaaaaa";
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "pi-burn" });
  await plugin(bb);
  disposers.push(() => harness.lifecycle.dispose());
  const post = (body: unknown, threadId = THREAD) =>
    harness.behavior.fetchHttp("POST", "/usage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const usage = (threadId = THREAD) =>
    harness.behavior.callRpc("usage", { threadId }) as Promise<{ report: unknown; reportedAt: number | null }>;
  const signals = () => harness.inspection.realtimeSignals.filter((s) => s.channel === "usage");
  return { bb, harness, post, usage, signals };
}

const envelope = (sentAt: number, over = {}, threadId = THREAD) => ({ threadId, sentAt, report: sampleReport(over) });

describe("burn plugin", () => {
  it("declares the chip setting", async () => {
    const s = await setup();
    expect(s.harness.inspection.registrations.settingsDescriptors.chip).toMatchObject({
      type: "boolean",
      label: "Cost chip",
      default: true,
    });
  });

  it("stores a posted report, publishes a signal and serves it over rpc (round trip with buildReport)", async () => {
    const s = await setup();
    const report = buildReport([user(), assistant(1.25)], { tokens: 1, window: 2, percent: 50 });
    const res = await s.post({ threadId: THREAD, sentAt: 1, report });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const got = await s.usage();
    expect(got.report).toEqual(report);
    expect(typeof got.reportedAt).toBe("number");
    expect(s.signals()).toEqual([{ channel: "usage", payload: { threadId: THREAD } }]);
  });

  it("answers null for a thread with no report", async () => {
    const s = await setup();
    expect(await s.usage("thr_bbbbbbbb")).toEqual({ report: null, reportedAt: null });
  });

  it("rejects an oversize body, bad JSON and an invalid report", async () => {
    const s = await setup();
    expect((await s.post("x".repeat(128 * 1024 + 1))).status).toBe(413);
    expect((await s.post("{nope")).status).toBe(400);
    expect((await s.post({ threadId: THREAD, sentAt: 1, report: { version: 1 } })).status).toBe(400);
    expect(s.signals()).toEqual([]);
  });

  it("ignores a report older than the stored one", async () => {
    const s = await setup();
    await s.post(envelope(10, { calls: 5 }));
    const stale = await s.post(envelope(5, { calls: 1 }));
    expect(await stale.json()).toEqual({ ok: true });
    expect((await s.usage()).report).toMatchObject({ calls: 5 });
    expect(s.signals()).toHaveLength(1);
  });

  it("keeps reports across a plugin reload", async () => {
    const s = await setup();
    await s.post(envelope(1));
    await s.harness.lifecycle.reload(plugin);
    expect((await s.usage()).report).toMatchObject({ calls: 23 });
  });

  it("drops a stored row that no longer matches the schema", async () => {
    const s = await setup();
    await s.bb.storage.kv.set(`report:${THREAD}`, { report: { version: 0 }, sentAt: 1, at: 1 });
    expect(await s.usage()).toEqual({ report: null, reportedAt: null });
    expect(await s.bb.storage.kv.get(`report:${THREAD}`)).toBeUndefined();
  });

  it("gives pi the report address", async () => {
    const s = await setup();
    const entries = await s.harness.behavior.resolveProviderEnv("pi", { threadId: THREAD, projectId: "proj_1", hostId: "host_1" });
    expect(entries.map((e) => [e.name, e.value])).toEqual([
      ["BURN_BB_URL", { serverPath: "/api/v1/plugins/pi-burn/http/usage" }],
    ]);
  });

  it("forgets a deleted thread", async () => {
    const s = await setup();
    await s.post(envelope(1));
    await s.harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: THREAD }) });
    expect(await s.usage()).toEqual({ report: null, reportedAt: null });
    expect(await s.bb.storage.kv.get(`report:${THREAD}`)).toBeUndefined();
  });

  it("evicts the least recently updated thread from memory above 500 threads", async () => {
    const s = await setup();
    const id = (n: number) => `thr_${String(n).padStart(8, "0")}`;
    for (let n = 0; n < 501; n++) await s.post(envelope(1, {}, id(n)), id(n));
    // The evicted thread still reads back from storage.
    expect((await s.usage(id(0))).report).not.toBeNull();
  });
});
