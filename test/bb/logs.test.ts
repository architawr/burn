import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createLogReports, parseSessionLog, sessionPath } from "../../extensions/bb/logs.js";
import { assistant, toolResult, user } from "../helpers.js";

const THREAD = "thr_aaaaaaaa";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const header = { type: "session", version: 3, id: "s", timestamp: "2026-10-18T12:00:00.000Z", cwd: "/tmp" };
const jsonl = (entries: unknown[]): string => `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

function setup(identities: Record<string, string[]> = { [THREAD]: ["pi_one"] }) {
  const dataDir = mkdtempSync(join(tmpdir(), "burn-logs-"));
  dirs.push(dataDir);
  mkdirSync(join(dataDir, "pi-bridge-sessions"));
  const lookups: string[] = [];
  const { bb } = createFakePluginHost({
    pluginId: "pi-burn",
    dataDir,
    sdk: {
      threads: {
        events: {
          list: async ({ threadId }: { threadId: string }) => {
            lookups.push(threadId);
            return (identities[threadId] ?? []).map((id, seq) => ({ type: "thread/identity", threadId, seq, data: { providerThreadId: id } }));
          },
        },
      },
    },
  });
  let now = 1_000_000;
  const write = (id: string, entries: unknown[], mtime?: number): void => {
    const path = sessionPath(dataDir, id);
    writeFileSync(path, jsonl([header, ...entries]));
    if (mtime !== undefined) utimesSync(path, mtime / 1000, mtime / 1000);
  };
  const logs = createLogReports(bb, { now: () => now, ttlMs: 10_000 });
  return { logs, write, dataDir, lookups, tick: (ms: number) => (now += ms) };
}

describe("sessionPath", () => {
  it("names the file the way bb's pi bridge does", () => {
    expect(sessionPath("/d", "pi_ef25-17")).toBe("/d/pi-bridge-sessions/pi_ef25-17.jsonl");
    expect(sessionPath("/d", "a/b c")).toBe("/d/pi-bridge-sessions/a_b_c.jsonl");
  });
});

describe("parseSessionLog", () => {
  it("drops the header, blank lines and a line pi is still writing", () => {
    const text = `${jsonl([header, user(), assistant(1)])}\n{"type":"message","timest`;
    expect(parseSessionLog(text).map((e) => e.type)).toEqual(["message", "message"]);
  });
});

describe("createLogReports", () => {
  it("builds the report from the thread's pi session log, as pi itself would", async () => {
    const s = setup();
    s.write("pi_one", [user("hi"), assistant(1.25), toolResult(0.25), user("again"), assistant(0.5)], 1_700_000_000_000);
    const got = await s.logs.reportOf(THREAD);
    expect(got?.report.cost.total).toBeCloseTo(2);
    expect(got?.report).toMatchObject({ calls: 2, turnCount: 2, running: false, budget: null });
    expect(got?.at).toBe(1_700_000_000_000);
  });

  it("adds up every session the thread had, oldest first", async () => {
    const s = setup({ [THREAD]: ["pi_one", "pi_two", "pi_gone"] });
    const older = [user("first"), assistant(1)];
    const newer = [user("second"), assistant(2)];
    s.write("pi_one", newer);
    s.write("pi_two", older);
    const got = await s.logs.reportOf(THREAD);
    expect(got?.report.cost.total).toBeCloseTo(3);
    expect(got?.report.turns.map((t) => t.prompt)).toEqual(["first", "second"]);
  });

  it("is null for a thread with no session log on this machine", async () => {
    const s = setup({ [THREAD]: ["pi_elsewhere"], thr_bbbbbbbb: [] });
    expect(await s.logs.reportOf(THREAD)).toBeNull();
    expect(await s.logs.reportOf("thr_bbbbbbbb")).toBeNull();
  });

  it("rereads a log only after it changes, and checks at most once per interval", async () => {
    const s = setup();
    s.write("pi_one", [user(), assistant(1)], 1_700_000_000_000);
    expect((await s.logs.reportOf(THREAD))?.report.cost.total).toBeCloseTo(1);
    s.write("pi_one", [user(), assistant(1), assistant(2)], 1_700_000_060_000);
    expect((await s.logs.reportOf(THREAD))?.report.cost.total).toBeCloseTo(1);
    s.tick(10_000);
    expect((await s.logs.reportOf(THREAD))?.report.cost.total).toBeCloseTo(3);
    expect(s.lookups).toEqual([THREAD]);
  });

  it("forgets a thread", async () => {
    const s = setup();
    s.write("pi_one", [user(), assistant(1)]);
    await s.logs.reportOf(THREAD);
    s.logs.forget(THREAD);
    s.write("pi_one", [user(), assistant(4)]);
    expect((await s.logs.reportOf(THREAD))?.report.cost.total).toBeCloseTo(4);
    expect(s.lookups).toEqual([THREAD, THREAD]);
  });
});
