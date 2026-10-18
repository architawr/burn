import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BurnPanel, type PanelTheme, panelLines } from "../../extensions/pi/panel.js";
import { sampleReport } from "../helpers.js";

const plain: PanelTheme = { fg: (_c, t) => t, bold: (t) => t };
const text = (lines: string[]) => lines.join("\n");

describe("panelLines", () => {
  it("shows the headline figures", () => {
    const out = text(panelLines(sampleReport(), plain, null));
    expect(out).toContain("Thread usage · 23 calls · since ");
    expect(out).toContain("$4.82 total");
    expect(out).toContain("last turn +$0.31");
    expect(out).toContain("$0.21 per call");
    expect(out).toContain("118k / 1.0M");
    expect(out).toContain("cache hit (session) 89.0%");
    expect(out).toContain("esc close");
    expect(out).not.toContain("/h");
  });

  it("lists the token kinds and models", () => {
    const out = text(panelLines(sampleReport(), plain, null));
    for (const word of ["input (uncached)", "cache read", "cache write", "output", "p/claude-opus", "p/claude-haiku"]) {
      expect(out).toContain(word);
    }
    expect(out).toContain("$2.22");
    expect(out).toContain("104k reasoning");
  });

  it("draws both sparklines", () => {
    const out = text(panelLines(sampleReport(), plain, null));
    expect(out).toMatch(/Cumulative cost\s+[▁-█]+/);
    expect(out).toMatch(/Cost per call\s+[▁-█]+/);
  });

  it("says the context is unknown right after compaction", () => {
    const out = text(panelLines(sampleReport({ context: { tokens: null, window: 1_000_000, percent: null } }), plain, null));
    expect(out).toContain("unknown until the next reply");
  });

  it("renders Other and Tools/summaries rows", () => {
    const report = sampleReport({
      byModel: [
        { key: "p/a", cost: 3, tokens: 10, calls: 3 },
        { key: "Tools/summaries", cost: 1, tokens: 10, calls: 0 },
        { key: "Other", cost: 0.5, tokens: 10, calls: 1 },
      ],
    });
    const out = text(panelLines(report, plain, null));
    expect(out).toContain("Tools/summaries");
    expect(out).toContain("Other");
  });

  it("shows an empty state with no calls", () => {
    expect(text(panelLines(sampleReport({ calls: 0, series: [], byModel: [] }), plain, null))).toContain("No model calls yet");
  });

  it("never exceeds the width", () => {
    for (const width of [20, 40, 80]) {
      for (const line of panelLines(sampleReport(), plain, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});

describe("BurnPanel", () => {
  it("closes on escape, q and Q only", () => {
    const onClose = vi.fn();
    const panel = new BurnPanel(sampleReport(), plain, onClose);
    panel.handleInput("x");
    expect(onClose).not.toHaveBeenCalled();
    for (const key of ["\x1b", "q", "Q"]) panel.handleInput(key);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("caches by width and drops the cache on invalidate", () => {
    const panel = new BurnPanel(sampleReport(), plain, () => {});
    const first = panel.render(60);
    expect(panel.render(60)).toBe(first);
    panel.invalidate();
    expect(panel.render(60)).not.toBe(first);
  });
});
