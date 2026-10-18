import { describe, expect, it, vi } from "vitest";
import burn from "../../extensions/pi/index.js";
import { assistant, user } from "../helpers.js";

type Handler = (event: unknown, ctx: unknown) => unknown;

function setup(opts: { entries?: unknown[]; mode?: string; hasUI?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    on: (name: string, handler: Handler) => void handlers.set(name, handler),
    registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
      void commands.set(name, def),
  };
  const setStatus = vi.fn();
  const notify = vi.fn();
  const custom = vi.fn(async () => undefined);
  const entries = opts.entries ?? [user(), assistant(1.5)];
  const ctx = {
    mode: opts.mode ?? "tui",
    hasUI: opts.hasUI ?? true,
    ui: {
      setStatus,
      notify,
      custom,
      theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t, getBgAnsi: () => "\x1b[48;2;1;2;3m" },
    },
    sessionManager: { getEntries: () => entries },
    getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
  };
  burn(pi as never);
  return { handlers, commands, setStatus, notify, custom, ctx };
}

describe("burn pi extension", () => {
  it("sets the pill after a turn and reads $0.00 with no calls", () => {
    const { handlers, setStatus, ctx } = setup();
    handlers.get("turn_end")?.({}, ctx);
    expect(setStatus).toHaveBeenLastCalledWith("burn", expect.stringContaining("$1.50"));
    const empty = setup({ entries: [] });
    empty.handlers.get("session_start")?.({}, empty.ctx);
    expect(empty.setStatus).toHaveBeenLastCalledWith("burn", expect.stringContaining("$0.00"));
  });

  it("listens on every refresh event", () => {
    const { handlers } = setup();
    for (const name of ["session_start", "session_tree", "session_compact", "turn_end", "agent_end"]) {
      expect(handlers.has(name), name).toBe(true);
    }
  });

  it("does not touch the status without a UI", () => {
    const { handlers, setStatus, ctx } = setup({ hasUI: false });
    handlers.get("turn_end")?.({}, ctx);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("opens the panel in the tui and notifies text elsewhere", async () => {
    const tui = setup();
    await tui.commands.get("burn")?.handler("", tui.ctx);
    expect(tui.custom).toHaveBeenCalled();
    const rpc = setup({ mode: "rpc" });
    await rpc.commands.get("burn")?.handler("", rpc.ctx);
    expect(rpc.custom).not.toHaveBeenCalled();
    expect(rpc.notify).toHaveBeenCalledWith(expect.stringContaining("Thread usage"), "info");
  });

  it("reports to bb with the context mode", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("BURN_BB_URL", "http://127.0.0.1:1/usage");
    vi.stubEnv("BB_THREAD_ID", "thr_abc123def4");
    try {
      const { handlers, ctx } = setup({ mode: "rpc" });
      handlers.get("turn_end")?.({}, ctx);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("swallows a failing session manager", () => {
    const { handlers, ctx } = setup();
    (ctx.sessionManager as { getEntries: () => never }).getEntries = () => {
      throw new Error("boom");
    };
    expect(() => handlers.get("turn_end")?.({}, ctx)).not.toThrow();
  });
});
