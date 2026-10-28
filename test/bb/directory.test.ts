import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createThreadDirectory } from "../../extensions/bb/directory.js";

const id = (n: number): string => `thr_${String(n).padStart(8, "0")}`;

/** A `threads.list` row, with the fields the directory reads. */
const row = (threadId: string, over: Record<string, unknown> = {}) => ({
  id: threadId,
  title: `Title of ${threadId}`,
  titleFallback: null,
  projectId: "proj_1",
  providerId: "pi",
  environmentId: "env_1",
  environmentHostId: "host_1",
  status: "idle",
  updatedAt: 1_000,
  archivedAt: null,
  deletedAt: null,
  visibility: "visible" as const,
  ...over,
});

function setup(pages: Record<string, unknown>[][], opts: { direct?: Record<string, unknown> } = {}) {
  let now = 1_000_000;
  const { bb, harness } = createFakePluginHost({
    pluginId: "burn",
    sdk: {
      threads: {
        list: async ({ offset = 0, limit }: { offset?: number; limit?: number } = {}) => {
          const all = pages.flat();
          return all.slice(offset, limit === undefined ? undefined : offset + limit);
        },
        get: async ({ threadId }: { threadId: string }) => {
          const found = opts.direct?.[threadId];
          if (found === undefined) throw new Error(`no thread ${threadId}`);
          return found;
        },
      },
      environments: { get: async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, hostId: "host_direct" }) },
    },
  });
  const directory = createThreadDirectory(bb, { now: () => now });
  return { bb, harness, directory, tick: (ms: number) => (now += ms) };
}

describe("createThreadDirectory", () => {
  it("pages through every thread once, then answers each one from that listing", async () => {
    const many = Array.from({ length: 201 }, (_, n) => row(id(n)));
    const s = setup([many]);
    const all = await s.directory.all();
    expect(all).toHaveLength(201);
    expect(all[0]).toMatchObject({ title: `Title of ${id(0)}`, projectId: "proj_1", providerId: "pi", environmentId: "env_1", hostId: "host_1" });
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(2);
    expect((await s.directory.one(id(2)))?.id).toBe(id(2));
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(2);
  });

  it("skips a deleted thread and leaves archived ones in", async () => {
    const s = setup([[row(id(1)), row(id(2), { deletedAt: 5 }), row(id(3), { archivedAt: 7 })]]);
    expect((await s.directory.all()).map((r) => r.id)).toEqual([id(1), id(3)]);
  });

  it("reads a thread the listing does not carry on its own, with the machine from its environment", async () => {
    const s = setup([[row(id(1))]], { direct: { [id(9)]: row(id(9), { environmentId: "env_9" }) } });
    expect(await s.directory.one(id(9))).toMatchObject({ id: id(9), hostId: "host_direct" });
    expect(s.harness.sdk.callsTo("threads.get")).toHaveLength(1);
    expect(await s.directory.one(id(8))).toBeNull();
  });

  it("lists again after a refresh or a TTL, and not before", async () => {
    const s = setup([[row(id(1))]]);
    await s.directory.all();
    await s.directory.all();
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(1);
    s.tick(60_000);
    await s.directory.all();
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(2);
    s.directory.refresh();
    await s.directory.all();
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(3);
  });

  it("takes one listing for many concurrent readers", async () => {
    const s = setup([[row(id(1)), row(id(2))]]);
    await Promise.all([s.directory.all(), s.directory.one(id(1)), s.directory.one(id(2)), s.directory.all()]);
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(1);
  });

  it("lists again when a refresh arrives while a listing is under way", async () => {
    const s = setup([[row(id(1))]]);
    const first = s.directory.all();
    s.directory.refresh();
    await first;
    await s.directory.all();
    expect(s.harness.sdk.callsTo("threads.list")).toHaveLength(2);
  });

  it("reads a thread the listing misses once, even for concurrent callers", async () => {
    const s = setup([[row(id(1))]], { direct: { [id(9)]: row(id(9)) } });
    const [a, b] = await Promise.all([s.directory.one(id(9)), s.directory.one(id(9))]);
    expect([a?.id, b?.id]).toEqual([id(9), id(9)]);
    expect(s.harness.sdk.callsTo("threads.get")).toHaveLength(1);
  });
});
