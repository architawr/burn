import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UsageReport } from "../../src/report.js";

export interface PanelTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  inverse(text: string): string;
}

/** What every view renders from; `width` is the space inside the frame. */
export interface ViewInput {
  report: UsageReport;
  budget: number | null;
  theme: PanelTheme;
  width: number;
}

export const PLAIN: PanelTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  inverse: (text) => text,
};

export const FLAME = "\uf06d";
export const FLAME_COLOR = "syntaxString";
const TRACK = "borderMuted";
export const BLOCKS = " ▁▂▃▄▅▆▇█";

export const KINDS = [
  { key: "input", label: "input", short: "in", color: "accent" },
  { key: "cacheRead", label: "cache read", short: "read", color: "success" },
  { key: "cacheWrite", label: "cache write", short: "write", color: "warning" },
  { key: "output", label: "output", short: "out", color: "mdLink" },
] as const;

export const stateColor = (state: string, fallback: string): string =>
  state === "over" ? "error" : state === "near" ? "warning" : fallback;

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const indent = (lines: string[], n: number): string[] => lines.map((l) => (l === "" ? l : " ".repeat(n) + l));

/** Plain text cut to `width` columns with an ellipsis; never emits escape codes. */
export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  let out = "";
  for (const ch of text) {
    if (visibleWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** A styled line cut to `width` columns. */
export const fit = (line: string, width: number): string =>
  visibleWidth(line) <= width ? line : truncateToWidth(line, Math.max(0, width), "…");

export function pad(line: string, width: number, align: "left" | "right" = "left"): string {
  const fitted = fit(line, width);
  const space = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
  return align === "left" ? fitted + space : space + fitted;
}

/** `left` and `right` on one line of `width`, right-aligned; drops `right` when both do not fit. */
export function spread(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  return gap >= 1 ? left + " ".repeat(gap) + right : fit(left, width);
}

/** Joins as many parts as fit in `width`, keeping their order. */
export function joinFitting(parts: string[], width: number, sep: string): string {
  let out = "";
  for (const part of parts) {
    const next = out === "" ? part : out + sep + part;
    if (visibleWidth(next) > width) break;
    out = next;
  }
  return out === "" && parts.length > 0 ? fit(parts[0] as string, width) : out;
}

/** Wraps parts onto as many lines as needed, each at most `width` wide. */
export function flow(parts: string[], width: number, sep: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const next = line === "" ? part : line + sep + part;
    if (line !== "" && visibleWidth(next) > width) {
      lines.push(line);
      line = fit(part, width);
    } else {
      line = fit(next, width);
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Plain text wrapped on spaces to lines of at most `width`, at most `max` lines. */
export function wrap(text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (visibleWidth(next) <= width) {
      line = next;
      continue;
    }
    if (line !== "") lines.push(line);
    line = clip(word, width);
    if (lines.length === max) break;
  }
  if (line !== "" && lines.length < max) lines.push(line);
  if (lines.length === max && visibleWidth(words.join(" ")) > visibleWidth(lines.join(" "))) {
    lines[max - 1] = clip(`${lines[max - 1]} …`, width);
  }
  return lines;
}

export function bar(theme: PanelTheme, fraction: number, width: number, color: string): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return theme.fg(color, "█".repeat(filled)) + theme.fg(TRACK, "░".repeat(width - filled));
}

/** A thin progress meter, for budgets and the context window. */
export function meter(theme: PanelTheme, fraction: number, width: number, color: string): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return theme.fg(color, "━".repeat(filled)) + theme.fg(TRACK, "━".repeat(width - filled));
}

/** One full-width bar split by value, each part at least one cell when it is not zero. */
export function stacked(theme: PanelTheme, parts: { value: number; color: string }[], width: number): string {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0 || width < 1) return theme.fg(TRACK, "░".repeat(Math.max(0, width)));
  let used = 0;
  let acc = 0;
  return parts
    .map((p, i) => {
      acc += Math.max(0, p.value);
      const end = i === parts.length - 1 ? width : Math.min(width, Math.round((acc / total) * width));
      const cells = Math.max(p.value > 0 && end > used ? 1 : 0, end - used);
      const text = "█".repeat(Math.min(cells, width - used));
      used += text.length;
      return theme.fg(p.color, text);
    })
    .join("");
}

/** Reduces `values` to at most `cells` buckets, keeping each bucket's maximum. */
export function buckets(values: readonly number[], cells: number): { value: number; from: number; to: number }[] {
  const n = Math.min(cells, values.length);
  const out: { value: number; from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * values.length) / n);
    const to = Math.floor(((i + 1) * values.length) / n);
    out.push({ value: Math.max(...values.slice(from, to)), from, to });
  }
  return out;
}

/**
 * A block chart `rows` tall: column i is `values[i]` scaled to `peak`, drawn
 * `cell` characters wide and followed by `gap` blanks, coloured by `colorOf`.
 * Every non-zero value shows at least the lowest block.
 */
export function blockChart(
  theme: PanelTheme,
  values: readonly number[],
  opts: { rows: number; peak: number; cell: number; gap: number; colorOf: (i: number) => string },
): string[] {
  const lines: string[] = [];
  const gap = " ".repeat(opts.gap);
  for (let r = opts.rows - 1; r >= 0; r--) {
    let line = "";
    values.forEach((v, i) => {
      const height = opts.peak > 0 ? Math.round((v / opts.peak) * opts.rows * 8) : 0;
      const fill = Math.max(v > 0 && r === 0 ? 1 : 0, Math.min(8, height - r * 8));
      line += (fill > 0 ? theme.fg(opts.colorOf(i), (BLOCKS[fill] as string).repeat(opts.cell)) : " ".repeat(opts.cell)) + gap;
    });
    lines.push(line);
  }
  return lines;
}

/** "Oct 17" for another day, local time. */
export const formatDay = (ms: number): string => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
