import { type BbPluginApi, defineRpcContract, type PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { THREAD_ID, usageEnvelopeSchema, usageReportSchema } from "./schema.js";

const REPORT_MAX_BYTES = 128 * 1024;
const MAX_THREADS = 500;
const kvKey = (threadId: string): string => `report:${threadId}`;

const storedSchema = z.object({ report: usageReportSchema, sentAt: z.number(), at: z.number() });
type Stored = z.infer<typeof storedSchema>;

export const rpcContract = defineRpcContract({
  usage: {
    input: z.object({ threadId: z.string().regex(THREAD_ID) }),
    output: z.object({ report: usageReportSchema.nullable(), reportedAt: z.number().nullable() }),
  },
});

export const SETTINGS = {
  chip: {
    type: "boolean",
    label: "Cost chip",
    description:
      "Shows what the thread has cost beside the context circle under the prompt box, or in the thread header when that row is not on screen. Hover it for the breakdown.",
    default: true,
  },
} satisfies PluginSettingDescriptors;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export default async function plugin(bb: BbPluginApi): Promise<void> {
  bb.settings.define(SETTINGS);
  const reports = new Map<string, Stored>();

  async function load(threadId: string): Promise<Stored | null> {
    const held = reports.get(threadId);
    if (held) return held;
    const raw = await bb.storage.kv.get<unknown>(kvKey(threadId));
    if (raw === undefined) return null;
    const parsed = storedSchema.safeParse(raw);
    if (!parsed.success) {
      await bb.storage.kv.delete(kvKey(threadId));
      return null;
    }
    return parsed.data;
  }

  function remember(threadId: string, stored: Stored): void {
    reports.delete(threadId);
    reports.set(threadId, stored);
    if (reports.size > MAX_THREADS) {
      const oldest = reports.keys().next().value;
      if (oldest !== undefined) reports.delete(oldest);
    }
  }

  bb.rpc.register(rpcContract, {
    usage: async ({ threadId }) => {
      const stored = await load(threadId);
      return { report: stored?.report ?? null, reportedAt: stored?.at ?? null };
    },
  });

  // The Burn pi extension reports each change here (extensions/pi/bb-report.ts).
  bb.http.route("POST", "/usage", async (c) => {
    const text = await c.req.text();
    if (text.length > REPORT_MAX_BYTES) return c.json({ ok: false, error: "usage report too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ ok: false, error: "usage report is not JSON" }, 400);
    }
    const envelope = usageEnvelopeSchema.safeParse(body);
    if (!envelope.success) return c.json({ ok: false, error: "invalid usage report" }, 400);
    const { threadId, sentAt, report } = envelope.data;
    const held = await load(threadId);
    if (held && sentAt < held.sentAt) return c.json({ ok: true });
    const stored: Stored = { report, sentAt, at: Date.now() };
    remember(threadId, stored);
    try {
      await bb.storage.kv.set(kvKey(threadId), stored);
    } catch (err) {
      bb.log.warn(`saving the usage report of ${threadId} failed: ${message(err)}`);
    }
    bb.realtime.publish("usage", { threadId });
    return c.json({ ok: true });
  });

  bb.providers.experimental_contributeEnv("pi", () => [
    {
      name: "BURN_BB_URL",
      value: { serverPath: `/api/v1/plugins/${bb.pluginId}/http/usage` },
      reason: "Where the Burn pi extension reports this thread's cost to the Burn plugin",
    },
  ]);

  bb.events.on("thread.deleted", async ({ thread }) => {
    reports.delete(thread.id);
    try {
      await bb.storage.kv.delete(kvKey(thread.id));
    } catch (err) {
      bb.log.warn(`forgetting the usage report of ${thread.id} failed: ${message(err)}`);
    }
  });
}
