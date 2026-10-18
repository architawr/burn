/** The plugin settings the app reads, with the defaults server.ts declares (test/bb/prefs.test.ts keeps them equal). */
export interface Prefs {
  chip: boolean;
  chipShows: "delta" | "cost";
  threadBudget: number | null;
  flagOverBudget: boolean;
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

export function readPrefs(values: Record<string, unknown> | undefined): Prefs {
  const v = values ?? {};
  const budget = v.threadBudget;
  return {
    chip: flag(v.chip, true),
    chipShows: v.chipShows === "cost" ? "cost" : "delta",
    threadBudget: typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? budget : null,
    flagOverBudget: flag(v.flagOverBudget, true),
  };
}
