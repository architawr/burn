import { describe, expect, it } from "vitest";
import { type PillTheme, renderPill } from "../../extensions/pi/pill.js";
import { buildReport } from "../../src/report.js";
import { sampleReport } from "../helpers.js";

const theme = (bg: string): PillTheme => ({
  fg: (color, text) => `<${color}>${text}</${color}>`,
  getBgAnsi: () => bg,
});
const TRUE = "\x1b[48;2;1;2;3m";
const CAP_L = "\ue0b6";
const CAP_R = "\ue0b4";

describe("renderPill", () => {
  it("reads $0.00 with no calls", () => {
    const empty = buildReport([], undefined);
    const pill = renderPill(theme(TRUE), empty);
    expect(pill).toContain("$0.00");
    expect(pill).not.toContain("+");
    expect(pill).toContain(CAP_L);
  });

  it("draws rounded caps in the background colour as a foreground code", () => {
    const pill = renderPill(theme(TRUE), sampleReport()) as string;
    expect(pill).toContain(`\x1b[38;2;1;2;3m${CAP_L}`);
    expect(pill).toContain(`${CAP_R}`);
    expect(pill).toContain(TRUE);
    expect(pill.endsWith("\x1b[39m")).toBe(true);
    expect(pill).not.toContain("\x1b[0m");
  });

  it("handles 256-colour backgrounds", () => {
    const pill = renderPill(theme("\x1b[48;5;240m"), sampleReport()) as string;
    expect(pill).toContain(`\x1b[38;5;240m${CAP_L}`);
  });

  it("falls back to a padded square pill when the background code is unexpected", () => {
    const pill = renderPill(theme("\x1b[49m"), sampleReport()) as string;
    expect(pill).not.toContain(CAP_L);
    expect(pill.startsWith(" <text>$4.82")).toBe(true);
  });

  it("shows the total and the last-turn delta", () => {
    const pill = renderPill(theme(TRUE), sampleReport()) as string;
    expect(pill).toContain("$4.82");
    expect(pill).toContain("+0.31");
  });

  it("hides the delta below 0.005", () => {
    expect(renderPill(theme(TRUE), sampleReport({ lastTurnCost: 0.004 }))).not.toContain("+");
  });

  it("shows tokens when the cost is zero", () => {
    const report = sampleReport({
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      lastTurnCost: 0,
      tokens: { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    const pill = renderPill(theme(TRUE), report) as string;
    expect(pill).toContain("1.2M tok");
    expect(pill).not.toContain("$");
  });

  it("colours the text by context use and tolerates an unknown percent", () => {
    const at = (percent: number | null) =>
      renderPill(theme(TRUE), sampleReport({ context: { tokens: 1, window: 2, percent } })) as string;
    expect(at(50)).toContain("<text>$4.82");
    expect(at(80)).toContain("<warning>$4.82");
    expect(at(95)).toContain("<error>$4.82");
    expect(at(null)).toContain("<text>$4.82");
  });
});
