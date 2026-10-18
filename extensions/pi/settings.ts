import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Burn's settings for pi in a terminal, in `<agent dir>/burn.json`. Every default is the quiet one. */
export interface BurnSettings {
  /** Dollars for threads without their own `/burn budget`, or null. */
  defaultBudget: number | null;
  /** Abort the run whose cost crosses the budget. Off by default. */
  stopAtBudget: boolean;
  /** Notify after a prompt that costs several times the thread's median. Off by default. */
  notifyExpensiveTurn: boolean;
}

export const DEFAULT_SETTINGS: BurnSettings = { defaultBudget: null, stopAtBudget: false, notifyExpensiveTurn: false };

export const settingsPath = (agentDir: string): string => join(agentDir, "burn.json");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function decode(value: unknown): BurnSettings | string {
  if (!isRecord(value)) return "expected a JSON object";
  const { defaultBudget = null, stopAtBudget = false, notifyExpensiveTurn = false } = value;
  const budgetOk = defaultBudget === null || (typeof defaultBudget === "number" && Number.isFinite(defaultBudget) && defaultBudget > 0);
  if (!budgetOk) return "defaultBudget must be a positive number or null";
  if (typeof stopAtBudget !== "boolean") return "stopAtBudget must be true or false";
  if (typeof notifyExpensiveTurn !== "boolean") return "notifyExpensiveTurn must be true or false";
  return { defaultBudget: defaultBudget as number | null, stopAtBudget, notifyExpensiveTurn };
}

/** The settings in `path`; a missing file is the defaults, a malformed one the defaults and an error. */
export function readSettings(path: string): { settings: BurnSettings; error: string | null } {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { settings: DEFAULT_SETTINGS, error: null };
    return { settings: DEFAULT_SETTINGS, error: `Burn could not read ${path}: ${(err as Error).message}. Using the defaults.` };
  }
  let decoded: BurnSettings | string;
  try {
    decoded = decode(JSON.parse(text));
  } catch (err) {
    decoded = (err as Error).message;
  }
  if (typeof decoded === "string") {
    return { settings: DEFAULT_SETTINGS, error: `Burn ignored ${path} (${decoded}) and is using the defaults.` };
  }
  return { settings: decoded, error: null };
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export function writeSettings(path: string, settings: BurnSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(temp, path);
}
