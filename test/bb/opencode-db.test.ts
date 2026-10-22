import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOpencodeDb } from "../../extensions/bb/host/opencode-db.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const AT = 1_700_000_000_000;

interface Message {
  id: string;
  session: string;
  at: number;
  updated?: number;
  data: Record<string, unknown>;
}

/** An opencode database with the two tables the reader queries, and the model catalog beside it. */
function setup(messages: Message[], parts: { id: string; message: string; session: string; text: string; at: number }[]) {
  const dir = mkdtempSync(join(tmpdir(), "burn-opencode-"));
  dirs.push(dir);
  const db = new DatabaseSync(join(dir, "opencode.db"));
  db.exec(`
    create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);
  `);
  const message = db.prepare("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)");
  for (const m of messages) message.run(m.id, m.session, m.at, m.updated ?? m.at, JSON.stringify(m.data));
  const part = db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)");
  for (const p of parts) part.run(p.id, p.message, p.session, p.at, p.at, JSON.stringify({ type: "text", text: p.text }));
  db.close();
  const modelsPath = join(dir, "models.json");
  writeFileSync(
    modelsPath,
    JSON.stringify({
      deepseek: {
        models: {
          "deepseek-v4-flash": { cost: { input: 0.15, output: 0.6, reasoning: 0.6, cache_read: 0.003 } },
        },
      },
    }),
  );
  return { path: join(dir, "opencode.db"), modelsPath, dir };
}

const assistant = (cost: number): Record<string, unknown> => ({
  role: "assistant",
  providerID: "deepseek",
  modelID: "deepseek-v4-flash",
  cost,
  tokens: { input: 1000, output: 500, reasoning: 100, cache: { read: 2000, write: 0 } },
  time: { created: AT, completed: AT + 2500 },
  finish: "tool-calls",
});

describe("createOpencodeDb", () => {
  it("turns opencode's user and assistant messages into a report, splitting the recorded cost by kind", async () => {
    const files = setup(
      [
        { id: "msg_user", session: "ses_1", at: AT, data: { role: "user", time: { created: AT } } },
        { id: "msg_a", session: "ses_1", at: AT + 1, updated: AT + 3000, data: assistant(0.005) },
      ],
      [
        { id: "part_1", message: "msg_user", session: "ses_1", text: "<system_instructions>…", at: AT },
        { id: "part_2", message: "msg_user", session: "ses_1", text: "привет  мир", at: AT + 1 },
      ],
    );
    const got = await createOpencodeDb(files).reportOf(["ses_1"], "UTC");
    expect(got?.at).toBe(AT + 3000);
    expect(got?.report.cost.total).toBeCloseTo(0.005, 9);
    const { cost } = got?.report ?? { cost: null };
    expect(cost).not.toBeNull();
    if (cost !== null) expect(cost.input + cost.output + cost.cacheRead + cost.cacheWrite).toBeCloseTo(0.005, 9);
    expect(got?.report.tokens).toMatchObject({ input: 1000, output: 500, cacheRead: 2000, reasoning: 100 });
    expect(got?.report.byModel).toMatchObject([{ key: "deepseek/deepseek-v4-flash", calls: 1 }]);
    expect(got?.report.turns).toMatchObject([{ n: 1, prompt: "привет мир", calls: 1, ms: 2500 }]);
    expect(got?.report.estimated).toBe(false);
  });

  it("prices the tokens at the catalog's rates when opencode recorded no cost", async () => {
    const files = setup([{ id: "msg_a", session: "ses_1", at: AT, data: assistant(0) }], []);
    const got = await createOpencodeDb(files).reportOf(["ses_1"], "UTC");
    expect(got?.report.cost.total).toBeCloseTo((1000 * 0.15 + 600 * 0.6 + 2000 * 0.003) / 1_000_000, 12);
    expect(got?.report.estimated).toBe(true);
  });

  it("returns null for a session the database does not have, and for a database that is not there", async () => {
    const files = setup([], []);
    expect(await createOpencodeDb(files).reportOf(["ses_missing"], "UTC")).toBeNull();
    expect(await createOpencodeDb({ path: join(files.dir, "missing.db"), modelsPath: files.modelsPath }).reportOf(["ses_1"], "UTC")).toBeNull();
  });
});
