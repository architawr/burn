import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { PanelView } from "./panel.js";

export const SUBCOMMANDS: AutocompleteItem[] = [
  { value: "turns", label: "turns", description: "what each prompt cost" },
  { value: "models", label: "models", description: "cost by model" },
  { value: "history", label: "history", description: "today, 7 and 30 days for this project" },
  { value: "budget", label: "budget", description: "show the budget in effect and where it comes from" },
  { value: "budget ", label: "budget <usd>|off", description: "set this thread's budget; warns at 80% and 100%" },
  { value: "budget default ", label: "budget default <usd>|off", description: "set the budget for threads without their own" },
  { value: "copy", label: "copy", description: "copy a Markdown summary to the clipboard" },
  { value: "settings", label: "settings", description: "stop a run at the budget (off by default), nudges, default budget" },
];

/** Completions for what follows `/burn `, or null when nothing matches. */
export function completions(prefix: string): AutocompleteItem[] | null {
  const typed = prefix.replace(/^\s+/, "").toLowerCase();
  const items = SUBCOMMANDS.filter((item) => item.value.startsWith(typed) && item.value !== typed);
  return items.length > 0 ? items : null;
}

export type Command =
  | { kind: "view"; view: PanelView }
  | { kind: "budget"; scope: "thread" | "default"; input: string | null }
  | { kind: "copy" }
  | { kind: "settings" }
  | { kind: "unknown"; name: string };

export function parseCommand(args: string): Command {
  const [name = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
  const sub = name.toLowerCase();
  if (sub === "" || sub === "overview") return { kind: "view", view: "overview" };
  if (sub === "turns" || sub === "models" || sub === "history") return { kind: "view", view: sub };
  if (sub === "copy") return { kind: "copy" };
  if (sub === "settings") return { kind: "settings" };
  if (sub === "budget") {
    if (rest[0]?.toLowerCase() === "default") return { kind: "budget", scope: "default", input: rest.length > 1 ? rest.slice(1).join(" ") : null };
    return { kind: "budget", scope: "thread", input: rest.length > 0 ? rest.join(" ") : null };
  }
  return { kind: "unknown", name };
}
