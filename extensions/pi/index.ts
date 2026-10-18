import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildReport, type UsageReport } from "../../src/report.js";
import { createBbReporter } from "./bb-report.js";
import { BurnPanel, type PanelTheme, panelLines } from "./panel.js";
import { renderPill } from "./pill.js";

const STATUS_KEY = "burn";
const PLAIN: PanelTheme = { fg: (_color, text) => text, bold: (text) => text };

function currentReport(ctx: ExtensionContext): UsageReport {
  const usage = ctx.getContextUsage();
  const context = usage ? { tokens: usage.tokens, window: usage.contextWindow, percent: usage.percent } : null;
  return buildReport(ctx.sessionManager.getEntries(), context);
}

export default function burn(pi: ExtensionAPI): void {
  const reporter = createBbReporter({});

  function refresh(ctx: ExtensionContext): void {
    try {
      const report = currentReport(ctx);
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, renderPill(ctx.ui.theme, report));
      void reporter.report(report, ctx.mode);
    } catch {
      // A malformed old entry must never break a pi event handler.
    }
  }

  pi.on("session_start", (_event, ctx) => refresh(ctx));
  pi.on("session_tree", (_event, ctx) => refresh(ctx));
  pi.on("session_compact", (_event, ctx) => refresh(ctx));
  pi.on("turn_end", (_event, ctx) => refresh(ctx));
  pi.on("agent_end", (_event, ctx) => refresh(ctx));

  pi.registerCommand("burn", {
    description: "What this thread has cost: tokens, cost by kind and by model, and per-call history",
    handler: async (_args, ctx) => {
      const report = currentReport(ctx);
      if (ctx.mode === "tui" && ctx.hasUI) {
        await ctx.ui.custom<undefined>((_tui, theme, _keybindings, done) => new BurnPanel(report, theme, () => done(undefined)));
        return;
      }
      ctx.ui.notify(panelLines(report, PLAIN, null).join("\n"), "info");
    },
  });
}
