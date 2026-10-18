import { describe, expect, it } from "vitest";
import { type PillTheme, renderPill, SPINNER } from "../../extensions/pi/pill.js";
import { buildReport } from "../../src/report.js";
import { sampleReport } from "../helpers.js";

const theme = (bg: string): PillTheme => ({
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bold: (text) => `*${text}*`,
  getBgAnsi: () => bg,
});
const TRUE = "\x1b[48;2;1;2;3m";
const CAP_L = "\ue0b6";
const CAP_R = "\ue0b4";
const FLAME = "\uf06d";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

describe("renderPill", () => {
  it("reads $0.00 with no calls", () => {
    const pill = renderPill(theme(TRUE), buildReport([], undefined), null);
    expect(pill).toContain("$0.00");
    expect(pill).not.toContain("+");
    expect(pill).toContain(CAP_L);
  });

  it("draws rounded caps in the background colour as a foreground code", () => {
    const pill = renderPill(theme(TRUE), sampleReport(), null);
    expect(pill).toContain(`\x1b[38;2;1;2;3m${CAP_L}`);
    expect(pill).toContain(CAP_R);
    expect(pill).toContain(TRUE);
    expect(pill.endsWith("\x1b[39m")).toBe(true);
    expect(pill).not.toContain("\x1b[0m");
  });

  it("handles 256-colour backgrounds", () => {
    expect(renderPill(theme("\x1b[48;5;240m"), sampleReport(), null)).toContain(`\x1b[38;5;240m${CAP_L}`);
  });

  it("falls back to a padded square pill when the background code is unexpected", () => {
    const pill = renderPill(theme("\x1b[49m"), sampleReport(), null);
    expect(pill).not.toContain(CAP_L);
    expect(pill.startsWith(` <syntaxString>${FLAME}</syntaxString> *<text>$4.82</text>*`)).toBe(true);
  });

  it("shows the flame, the bold total and the dimmed delta with its dollar sign when idle", () => {
    const pill = renderPill(theme(TRUE), sampleReport(), null);
    expect(pill).toContain(`<syntaxString>${FLAME}</syntaxString>`);
    expect(pill).toContain("*<text>$4.82</text>*");
    expect(pill).toContain("<dim>+$0.31</dim>");
  });

  it("hides the delta below half a cent", () => {
    expect(renderPill(theme(TRUE), sampleReport({ lastTurnCost: 0.004 }), null)).not.toContain("+");
  });

  it("swaps the flame for a spinner frame and shows the growing delta in the accent colour while running", () => {
    const report = sampleReport({ running: true, lastTurnCost: 0.12 });
    const pill = renderPill(theme(TRUE), report, null, 2);
    expect(pill).toContain(`<accent>${SPINNER[2]}</accent>`);
    expect(pill).not.toContain(FLAME);
    expect(pill).toContain("<accent>+$0.12…</accent>");
    expect(renderPill(theme(TRUE), report, null, SPINNER.length + 1)).toContain(SPINNER[1]);
  });

  it("turns amber near the budget and shows the budget in place of the delta", () => {
    const pill = renderPill(theme(TRUE), sampleReport({ cost: { ...sampleReport().cost, total: 8.1 } }), 10);
    expect(pill).toContain(`<warning>${FLAME}</warning>`);
    expect(pill).toContain("*<warning>$8.10</warning>*");
    expect(pill).toContain("<dim> / $10</dim>");
    expect(pill).not.toContain("+$0.31");
  });

  it("turns red over the budget and adds a marker", () => {
    const pill = renderPill(theme(TRUE), sampleReport({ cost: { ...sampleReport().cost, total: 12.4 } }), 10);
    expect(pill).toContain(`<error>${FLAME}</error>`);
    expect(pill).toContain("*<error>$12.40</error>*");
    expect(pill).toContain("<error> / $10 ▲</error>");
  });

  it("keeps the idle look under 80% of a budget", () => {
    const pill = renderPill(theme(TRUE), sampleReport(), 10);
    expect(pill).toContain("*<text>$4.82</text>*");
    expect(pill).toContain("+$0.31");
    expect(pill).not.toContain("/ $10");
  });

  it("shows tokens with a dimmed flame when the cost is zero", () => {
    const report = sampleReport({
      cost: ZERO_COST,
      lastTurnCost: 0,
      tokens: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    const pill = renderPill(theme(TRUE), report, null);
    expect(pill).toContain(`<dim>${FLAME}</dim>`);
    expect(pill).toContain("1.2M tok");
    expect(pill).not.toContain("$");
  });

  it("no longer colours by context use", () => {
    const pill = renderPill(theme(TRUE), sampleReport({ context: { tokens: 1, window: 2, percent: 95 } }), null);
    expect(pill).toContain("*<text>$4.82</text>*");
  });
});
