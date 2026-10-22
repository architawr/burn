import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildReport, type EntryLike, type UsageReport } from "../../../src/report.js";

/** A session long enough to hit this is read from its first messages; the newest ones matter most for a live chip. */
const MESSAGES_MAX = 20_000;
const PER_MILLION = 1_000_000;

/** Where opencode keeps its database, following XDG like opencode itself. */
export function opencodeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const data = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== "" ? env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  return join(data, "opencode", "opencode.db");
}

/** Where opencode caches models.dev's catalog, whose prices split a recorded cost into its kinds. */
export function opencodeModelsPath(env: NodeJS.ProcessEnv = process.env): string {
  const cache = env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== "" ? env.XDG_CACHE_HOME : join(homedir(), ".cache");
  return join(cache, "opencode", "models.json");
}

interface Rates {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  estimated: boolean;
}

interface MessageRow {
  id: string;
  data: string;
  time_created: number;
  time_updated: number;
}

interface PartRow {
  message_id: string;
  data: string;
}

export interface OpencodeDb {
  /** The report of a thread's opencode sessions on this machine; null when the database has none of them. */
  reportOf(sessionIds: readonly string[], timeZone: string): Promise<{ report: UsageReport; at: number } | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function parse(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ratesOf(catalog: unknown, providerId: string, modelId: string): Rates | null {
  if (!isRecord(catalog) || !isRecord(catalog[providerId])) return null;
  const models = catalog[providerId].models;
  if (!isRecord(models) || !isRecord(models[modelId]) || !isRecord(models[modelId].cost)) return null;
  const cost = models[modelId].cost;
  return {
    input: num(cost.input),
    output: num(cost.output),
    reasoning: num(cost.reasoning ?? cost.output),
    cacheRead: num(cost.cache_read),
    cacheWrite: num(cost.cache_write),
  };
}

/**
 * A message's tokens as Burn's usage. opencode records the call's cost, so the
 * token prices only split that total into input, output, cache read and write;
 * without a recorded cost they price the tokens instead and mark the result an
 * estimate.
 */
function usageOf(data: Record<string, unknown>, rates: Rates | null): Usage | null {
  const tokens = isRecord(data.tokens) ? data.tokens : null;
  if (tokens === null) return null;
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const input = num(tokens.input);
  const output = num(tokens.output);
  const reasoning = num(tokens.reasoning);
  const cacheRead = num(cache.read);
  const cacheWrite = num(cache.write);
  if (input + output + reasoning + cacheRead + cacheWrite === 0) return null;

  const raw =
    rates === null
      ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      : {
          input: (input * rates.input) / PER_MILLION,
          output: (output * rates.output + reasoning * rates.reasoning) / PER_MILLION,
          cacheRead: (cacheRead * rates.cacheRead) / PER_MILLION,
          cacheWrite: (cacheWrite * rates.cacheWrite) / PER_MILLION,
        };
  const rawTotal = raw.input + raw.output + raw.cacheRead + raw.cacheWrite;
  const recorded = num(data.cost);
  const total = recorded > 0 ? recorded : rawTotal;
  const scale = rawTotal > 0 ? total / rawTotal : 0;
  const cost = {
    input: raw.input * scale,
    output: raw.output * scale,
    cacheRead: raw.cacheRead * scale,
    cacheWrite: raw.cacheWrite * scale,
    total,
  };
  return { input, output, cacheRead, cacheWrite, reasoning, cost, estimated: recorded <= 0 && rawTotal > 0 };
}

/**
 * Reads opencode's own SQLite database, where every assistant message records
 * the tokens and cost of its call, so ACP threads show up in Burn even though
 * bb's ACP bridge records no usage events for them.
 */
export function createOpencodeDb(opts: { path: string; modelsPath?: string }): OpencodeDb {
  const modelsPath = opts.modelsPath ?? opencodeModelsPath();
  let catalog: unknown = null;
  let catalogRead = false;

  function prices(): unknown {
    if (!catalogRead) {
      catalogRead = true;
      try {
        catalog = JSON.parse(readFileSync(modelsPath, "utf8")) as unknown;
      } catch {
        catalog = null;
      }
    }
    return catalog;
  }

  return {
    async reportOf(sessionIds, timeZone) {
      const ids = [...new Set(sessionIds)].filter((id) => id !== "");
      if (ids.length === 0) return null;
      let db: DatabaseSync;
      try {
        db = new DatabaseSync(opts.path, { readOnly: true });
      } catch {
        return null;
      }
      try {
        const messages = db.prepare("select id, data, time_created, time_updated from message where session_id = ? order by time_created, id limit ?");
        const texts = db.prepare("select message_id, data from part where session_id = ? and json_extract(data, '$.type') = 'text' order by time_created, id");
        const entries: EntryLike[] = [];
        let at = 0;
        for (const sessionId of ids) {
          const rows = messages.all(sessionId, MESSAGES_MAX) as unknown as MessageRow[];
          if (rows.length === 0) continue;
          const prompts = new Map<string, string>();
          for (const part of texts.all(sessionId) as unknown as PartRow[]) {
            const text = parse(part.data)?.text;
            if (typeof text === "string") prompts.set(part.message_id, text.replace(/\s+/g, " ").trim());
          }
          for (const row of rows) {
            const data = parse(row.data);
            if (data === null) continue;
            const time = isRecord(data.time) ? data.time : {};
            const created = num(time.created) || num(row.time_created);
            if (created <= 0) continue;
            const updated = num(time.updated) || num(row.time_updated) || created;
            at = Math.max(at, updated);
            const timestamp = new Date(created).toISOString();
            if (data.role === "user") {
              const entry = { type: "message", timestamp, message: { role: "user", content: prompts.get(row.id) ?? "" } } as EntryLike;
              entries.push(entry);
              continue;
            }
            if (data.role !== "assistant") continue;
            const provider = typeof data.providerID === "string" && data.providerID !== "" ? data.providerID : "unknown";
            const model = typeof data.modelID === "string" && data.modelID !== "" ? data.modelID : "unknown";
            const usage = usageOf(data, ratesOf(prices(), provider, model));
            if (usage === null) continue;
            const completed = num(time.completed);
            const durationMs = completed > created ? completed - created : undefined;
            const entry = {
              type: "message",
              timestamp,
              message: {
                role: "assistant",
                provider,
                model,
                ...(durationMs !== undefined ? { durationMs } : {}),
                ...(data.finish === "error" ? { stopReason: "error" } : {}),
                usage,
              },
            } as EntryLike;
            entries.push(entry);
          }
        }
        if (entries.length === 0) return null;
        entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        return { report: buildReport(entries, null, { timeZone }), at: at || Date.now() };
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
  };
}
