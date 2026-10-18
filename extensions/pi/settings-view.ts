import { type Component, type SettingItem, SettingsList, type SettingsListTheme } from "@earendil-works/pi-tui";
import { EXPENSIVE_MIN_USD, EXPENSIVE_MULTIPLE, NEAR_FRACTION, parseBudget } from "../../src/budget.js";
import { formatBudget, formatUsd } from "../../src/format.js";
import { fit, type PanelTheme } from "./draw.js";
import type { BurnSettings } from "./settings.js";

const BUDGET_CHOICES = [null, 5, 10, 25, 50, 100];

export const STOP_LABEL = "Stop a run at the budget";
export const STOP_DESCRIPTION =
  "Off by default. When on, Burn stops only the run whose cost crosses the budget; send another prompt to keep going. " +
  "A thread already over its budget is never stopped again.";
const NUDGE_LABEL = "Nudge after an expensive prompt";
const NUDGE_DESCRIPTION = `Off by default. Notifies after a prompt that costs ${EXPENSIVE_MULTIPLE}× this thread's median prompt and at least ${formatUsd(EXPENSIVE_MIN_USD)}.`;
const DEFAULT_LABEL = "Default budget";
const DEFAULT_DESCRIPTION = `For threads without their own /burn budget. Burn warns at ${Math.round(NEAR_FRACTION * 100)}% and 100%. /burn budget default <usd> sets any amount.`;

const onOff = (on: boolean): string => (on ? "on" : "off");
const budgetText = (b: number | null): string => (b === null ? "off" : formatBudget(b));

export function settingItems(settings: BurnSettings): SettingItem[] {
  const budgets = [...new Set([...BUDGET_CHOICES, settings.defaultBudget])].sort((a, b) => (a ?? 0) - (b ?? 0));
  return [
    { id: "stopAtBudget", label: STOP_LABEL, description: STOP_DESCRIPTION, currentValue: onOff(settings.stopAtBudget), values: ["off", "on"] },
    {
      id: "notifyExpensiveTurn",
      label: NUDGE_LABEL,
      description: NUDGE_DESCRIPTION,
      currentValue: onOff(settings.notifyExpensiveTurn),
      values: ["off", "on"],
    },
    { id: "defaultBudget", label: DEFAULT_LABEL, description: DEFAULT_DESCRIPTION, currentValue: budgetText(settings.defaultBudget), values: budgets.map(budgetText) },
  ];
}

export function applySetting(settings: BurnSettings, id: string, value: string): BurnSettings {
  if (id === "stopAtBudget") return { ...settings, stopAtBudget: value === "on" };
  if (id === "notifyExpensiveTurn") return { ...settings, notifyExpensiveTurn: value === "on" };
  if (id === "defaultBudget") {
    const budget = parseBudget(value);
    return budget === undefined ? settings : { ...settings, defaultBudget: budget };
  }
  return settings;
}

/** `/burn settings` outside the TUI. */
export function settingsText(settings: BurnSettings, path: string): string {
  return [
    "Burn settings",
    `${STOP_LABEL}: ${onOff(settings.stopAtBudget)}. ${STOP_DESCRIPTION}`,
    `${NUDGE_LABEL}: ${onOff(settings.notifyExpensiveTurn)}. ${NUDGE_DESCRIPTION}`,
    `${DEFAULT_LABEL}: ${budgetText(settings.defaultBudget)}. ${DEFAULT_DESCRIPTION}`,
    `Change them with /burn settings in the terminal, or edit ${path}:`,
    `{ "defaultBudget": 10, "stopAtBudget": false, "notifyExpensiveTurn": false }`,
  ].join("\n");
}

export function settingsComponent(
  theme: PanelTheme,
  settings: BurnSettings,
  onChange: (id: string, value: string) => void,
  onClose: () => void,
  requestRender: () => void,
): Component {
  const listTheme: SettingsListTheme = {
    label: (text, selected) => (selected ? theme.fg("accent", text) : text),
    value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
    description: (text) => theme.fg("dim", text),
    cursor: theme.fg("accent", "→ "),
    hint: (text) => theme.fg("dim", text),
  };
  const items = settingItems(settings);
  const list = new SettingsList(items, items.length + 2, listTheme, onChange, onClose);
  return {
    render: (width) => [
      fit(theme.bold(theme.fg("accent", "Burn settings")), width),
      fit(theme.fg("dim", "Saved to burn.json in pi's agent directory."), width),
      "",
      ...list.render(width),
    ],
    invalidate: () => list.invalidate(),
    handleInput: (data) => {
      list.handleInput(data);
      requestRender();
    },
  };
}
