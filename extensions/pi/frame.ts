import { visibleWidth } from "@earendil-works/pi-tui";
import { clip, FLAME, FLAME_COLOR, type PanelTheme, pad } from "./draw.js";

const BORDER = "border";

function tabStrip(theme: PanelTheme, tabs: readonly string[], active: number, room: number): string {
  const on = (text: string) => theme.inverse(theme.bold(theme.fg("accent", ` ${text} `)));
  const full = tabs.map((t, i) => (i === active ? on(t) : theme.fg("dim", ` ${t} `))).join("");
  if (visibleWidth(full) <= room) return full;
  const position = `${active + 1}/${tabs.length}`;
  const named = on(`${tabs[active]} ${position}`);
  if (visibleWidth(named) <= room) return named;
  return visibleWidth(position) + 2 <= room ? on(position) : "";
}

/** Keeps the last part ("esc close") and drops the ones before it until the hint fits. */
export function fitHint(parts: string[], width: number): string {
  const kept = [...parts];
  while (kept.length > 1 && visibleWidth(kept.join(" · ")) > width) kept.splice(kept.length - 2, 1);
  return clip(kept.join(" · "), width);
}

/**
 * The rounded box around the panel: the flame, "Burn" and the tabs on the top
 * border, the key hints centred on the bottom one. Every line is `width` wide.
 */
export function frame(
  theme: PanelTheme,
  width: number,
  opts: { tabs: readonly string[]; active: number; body: readonly string[]; hint: string },
): string[] {
  const inner = Math.max(0, width - 2);
  const border = (text: string) => theme.fg(BORDER, text);
  const headWidth = 10;
  let top: string;
  if (width < headWidth + 2) {
    top = border(`╭${"─".repeat(inner)}╮`);
  } else {
    const head = `${border("╭─ ")}${theme.fg(FLAME_COLOR, FLAME)} ${theme.bold(theme.fg("accent", "Burn"))} `;
    const tabs = tabStrip(theme, opts.tabs, opts.active, width - headWidth - 3);
    top = head + border("─".repeat(width - headWidth - visibleWidth(tabs) - 2)) + tabs + border("─╮");
  }
  const body = opts.body.map((line) => border("│") + pad(line, inner) + border("│"));
  const hint = opts.hint === "" || inner < 6 ? "" : ` ${clip(opts.hint, inner - 4)} `;
  const left = Math.floor((inner - visibleWidth(hint)) / 2);
  const bottom =
    border(`╰${"─".repeat(left)}`) + theme.fg("dim", hint) + border(`${"─".repeat(inner - left - visibleWidth(hint))}╯`);
  return [top, ...body, bottom];
}
