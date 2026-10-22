import type { ExperimentalHostRpcContext, ExperimentalHostWatchEvent, ExperimentalHostWatchSubscription } from "@get-bb/plugin-sdk";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { CHANGED_MAX, hostContract, hostSignals } from "./contract.js";
import { createOpencodeDb, opencodeDbPath } from "./opencode-db.js";
import { createPiSessions, sessionDir } from "./pi-sessions.js";

type Context = ExperimentalHostRpcContext<typeof hostSignals>;

/**
 * The Burn host entry: reads pi's session logs and opencode's database on the
 * machine bb runs it on, and signals the server as soon as a pi log changes so
 * the chip updates live.
 */
export function createHostEntry(opts: { dir: string; opencodeDb?: string; opencodeModels?: string }) {
  const sessions = createPiSessions({ dir: opts.dir });
  const opencode = createOpencodeDb({ path: opts.opencodeDb ?? opencodeDbPath(), modelsPath: opts.opencodeModels });
  let watch: Promise<ExperimentalHostWatchSubscription | null> | null = null;

  async function onEvent(event: ExperimentalHostWatchEvent, context: Context): Promise<void> {
    if (event.kind === "watch-error") {
      const broken = watch;
      watch = null;
      // Already broken; the next call starts a new watch whether or not this one closes cleanly.
      await broken?.then((s) => s?.dispose()).catch(() => undefined);
      return;
    }
    if (event.kind === "rescan-required") return context.experimental_emitSignal("changed", { sessionIds: [], all: true });
    const ids = [...new Set(event.changes.map((c) => sessions.sessionIdOf(c.path)).filter((id) => id !== null))];
    if (ids.length === 0) return;
    await context.experimental_emitSignal("changed", ids.length > CHANGED_MAX ? { sessionIds: [], all: true } : { sessionIds: ids, all: false });
  }

  /** Watches the session folder from the first call on; a folder that does not exist yet is tried again next call. */
  function ensureWatch(context: Context): Promise<ExperimentalHostWatchSubscription | null> {
    watch ??= context.experimental_watch({ rootPath: opts.dir, debounceMs: 150, maxWaitMs: 1000 }, (event) => onEvent(event, context)).then(
      async (subscription) => {
        if (!context.signal.aborted) return subscription;
        // bb disposes a watch whose call was cancelled before the watch was ready.
        watch = null;
        await subscription.dispose().catch(() => undefined);
        return null;
      },
      () => {
        watch = null;
        return null;
      },
    );
    return watch;
  }

  return experimental_defineHostEntry({
    contract: hostContract,
    experimental_signals: hostSignals,
    handlers: {
      reports: async ({ harness, threads, timeZone }, context) => {
        if (harness === "pi") await ensureWatch(context);
        const reports = [];
        for (const { threadId, sessionIds } of threads) {
          context.signal.throwIfAborted();
          const got = harness === "opencode" ? await opencode.reportOf(sessionIds, timeZone) : await sessions.reportOf(sessionIds, timeZone);
          reports.push({ threadId, report: got?.report ?? null, at: got?.at ?? null });
        }
        return { dir: opts.dir, reports };
      },
    },
  });
}

export default createHostEntry({ dir: sessionDir() });
