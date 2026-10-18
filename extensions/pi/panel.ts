import { Key, matchesKey } from "@earendil-works/pi-tui";
import { summaryMarkdown } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import type { PanelTheme } from "./draw.js";
import { fitHint, frame } from "./frame.js";
import { RANGES, type SessionSummary } from "./history.js";
import { type HistoryData, type HistoryState, historyIndex, historyTotals, historyView } from "./history-view.js";
import { modelsLines } from "./models.js";
import { overviewLines } from "./overview.js";
import { selectedIndex, type TurnsState, turnList, turnsView } from "./turns.js";

export const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "turns", label: "Turns" },
  { key: "models", label: "Models" },
  { key: "history", label: "History" },
] as const;

export type PanelView = (typeof VIEWS)[number]["key"];

/** What closing the panel asks for: nothing, or resuming another session. */
export type PanelResult = { resume: string } | undefined;

export interface PanelOptions {
  report: UsageReport;
  budget: number | null;
  theme: PanelTheme;
  done: (result: PanelResult) => void;
  view?: PanelView;
  /** Terminal rows, to keep the panel on screen. */
  rows?: () => number;
  requestRender?: () => void;
  copy?: (text: string) => Promise<void>;
  /** Used as the title of the copied summary. */
  title?: string;
  history?: { cwd: string; currentPath: string | null; currentTitle: string; load: () => Promise<SessionSummary[]> };
  now?: () => number;
}

/** Rows the overlay leaves to the terminal: its two borders and a margin. */
const CHROME = 4;
const MIN_BODY = 8;
const FLASH_MS = 2000;

const isKey = (data: string, ...keys: string[]): boolean => keys.some((k) => matchesKey(data, k as Parameters<typeof matchesKey>[1]));

export class BurnPanel {
  private report: UsageReport;
  private budget: number | null;
  private view: number;
  private readonly scroll = new Map<PanelView, number>();
  private readonly turns: TurnsState = { selected: null, expanded: false, top: 0 };
  private readonly historyState: HistoryState = { range: 0, utc: false, selected: null, top: 0 };
  private historyData: HistoryData | null = null;
  private flash: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private bodyHeight = MIN_BODY;
  private cached: { width: number; lines: string[] } | null = null;
  private closed = false;

  constructor(private readonly opts: PanelOptions) {
    this.report = opts.report;
    this.budget = opts.budget;
    this.view = Math.max(0, VIEWS.findIndex((v) => v.key === (opts.view ?? "overview")));
    if (this.current() === "history") this.loadHistory();
  }

  /** Hands the open panel a fresh report; the caller requests the render. */
  update(report: UsageReport, budget: number | null): void {
    this.report = report;
    this.budget = budget;
    this.cached = null;
  }

  current(): PanelView {
    return VIEWS[this.view]!.key;
  }

  render(width: number): string[] {
    if (this.cached?.width === width) return this.cached.lines;
    const inner = Math.max(0, width - 2);
    const base = { report: this.report, budget: this.budget, theme: this.opts.theme, width: inner };
    const overview = overviewLines(base);
    const available = Math.max(MIN_BODY, (this.opts.rows?.() ?? 40) - CHROME - 2);
    const least = Math.min(available, Math.max(MIN_BODY, overview.length));
    let body: string[];
    let scrollable = false;
    const view = this.current();
    if (view === "turns") {
      const out = turnsView({ ...base, height: available, state: this.turns });
      this.turns.top = out.top;
      body = out.lines;
    } else if (view === "history") {
      const out = historyView({ ...base, height: available, state: this.historyState, source: this.historySource() });
      this.historyState.top = out.top;
      body = out.lines;
    } else {
      const all = view === "overview" ? overview : modelsLines(base);
      scrollable = all.length > available;
      const top = Math.max(0, Math.min(this.scroll.get(view) ?? 0, all.length - available));
      this.scroll.set(view, top);
      body = all.slice(top, top + available);
    }
    while (body.length < least) body.push("");
    this.bodyHeight = body.length;
    const hint = this.flash ?? fitHint(this.hints(scrollable), Math.max(0, inner - 4));
    const lines = frame(this.opts.theme, width, { tabs: VIEWS.map((v) => v.label), active: this.view, body, hint });
    this.cached = { width, lines };
    return lines;
  }

  handleInput(data: string): void {
    const view = this.current();
    if (isKey(data, Key.escape, "q", "shift+q")) return this.close(undefined);
    if (isKey(data, Key.tab, Key.right)) return this.show(this.view + 1);
    if (isKey(data, "shift+tab", Key.left)) return this.show(this.view - 1);
    const digit = ["1", "2", "3", "4"].findIndex((d) => isKey(data, d));
    if (digit !== -1) return this.show(digit);
    if (isKey(data, "c")) return this.copy();
    const page = Math.max(1, this.bodyHeight - 2);
    const move = isKey(data, Key.up)
      ? -1
      : isKey(data, Key.down)
        ? 1
        : isKey(data, Key.pageUp)
          ? -page
          : isKey(data, Key.pageDown)
            ? page
            : isKey(data, Key.home)
              ? -Infinity
              : isKey(data, Key.end)
                ? Infinity
                : 0;
    if (view === "turns") {
      if (move !== 0) this.moveTurn(move);
      else if (isKey(data, Key.enter)) this.turns.expanded = !this.turns.expanded;
      else return;
    } else if (view === "history") {
      if (move !== 0) this.moveSession(move);
      else if (isKey(data, "[", "]")) this.historyState.range = (this.historyState.range + (isKey(data, "]") ? 1 : RANGES.length - 1)) % RANGES.length;
      else if (isKey(data, "u")) this.historyState.utc = !this.historyState.utc;
      else if (isKey(data, Key.enter)) return this.resume();
      else return;
    } else if (move !== 0) {
      const next = (this.scroll.get(view) ?? 0) + (Number.isFinite(move) ? move : move > 0 ? 1e6 : -1e6);
      this.scroll.set(view, Math.max(0, next));
    } else return;
    this.changed();
  }

  invalidate(): void {
    this.cached = null;
  }

  dispose(): void {
    this.closed = true;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  private hints(scrollable: boolean): string[] {
    switch (this.current()) {
      case "turns":
        return ["↑↓ select", this.turns.expanded ? "enter collapse" : "enter expand", "tab views", "c copy", "esc close"];
      case "history":
        return ["[ ] range", this.historyState.utc ? "u local" : "u UTC", "↑↓ select", "enter resume", "tab views", "esc close"];
      default:
        return ["tab views", ...(scrollable ? ["↑↓ scroll"] : []), "1-4 jump", "c copy", "esc close"];
    }
  }

  private changed(): void {
    this.cached = null;
    if (!this.closed) this.opts.requestRender?.();
  }

  private show(index: number): void {
    this.view = (index + VIEWS.length) % VIEWS.length;
    if (this.current() === "history") this.loadHistory();
    this.changed();
  }

  private close(result: PanelResult): void {
    this.dispose();
    this.opts.done(result);
  }

  private moveTurn(move: number): void {
    const list = turnList(this.report.turns);
    if (list.length === 0) return;
    const index = Math.max(0, Math.min(list.length - 1, selectedIndex(list, this.turns.selected) + move));
    this.turns.selected = list[index]!.n;
  }

  private historySource() {
    const h = this.opts.history;
    return {
      cwd: h?.cwd ?? "",
      currentPath: h?.currentPath ?? null,
      currentTitle: h?.currentTitle ?? "This session",
      now: (this.opts.now ?? Date.now)(),
      data: this.historyData ?? ({ status: "loading" } as const),
    };
  }

  private moveSession(move: number): void {
    const totals = historyTotals(this.historySource(), this.report, this.historyState.range, this.historyState.utc);
    if (totals.sessions.length === 0) return;
    const index = Math.max(0, Math.min(totals.sessions.length - 1, historyIndex(totals, this.historyState.selected) + move));
    this.historyState.selected = totals.sessions[index]!.session.path;
  }

  private resume(): void {
    const totals = historyTotals(this.historySource(), this.report, this.historyState.range, this.historyState.utc);
    const row = totals.sessions[historyIndex(totals, this.historyState.selected)];
    if (!row) return;
    if (row.session.path === this.opts.history?.currentPath) return this.flashHint("This is the open session");
    this.close({ resume: row.session.path });
  }

  private loadHistory(): void {
    const h = this.opts.history;
    if (this.historyData !== null) return;
    if (!h) {
      this.historyData = { status: "error", message: "History is not available here" };
      return;
    }
    this.historyData = { status: "loading" };
    h.load().then(
      (sessions) => {
        this.historyData = { status: "ready", sessions };
        this.changed();
      },
      (err: unknown) => {
        this.historyData = { status: "error", message: err instanceof Error ? err.message : String(err) };
        this.changed();
      },
    );
  }

  private copy(): void {
    const copy = this.opts.copy;
    if (!copy) return;
    const text = summaryMarkdown(this.report, { title: this.opts.title, budget: this.budget });
    copy(text).then(
      () => this.flashHint("Copied the summary as Markdown"),
      (err: unknown) => this.flashHint(`Copy failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  private flashHint(text: string): void {
    this.flash = text;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flash = null;
      this.flashTimer = null;
      this.changed();
    }, FLASH_MS);
    this.flashTimer.unref?.();
    this.changed();
  }
}
