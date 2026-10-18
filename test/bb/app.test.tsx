// @vitest-environment jsdom
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";
import { FLAME_ICON } from "../../extensions/bb/icon.js";
import { SpendPage } from "../../extensions/bb/spend/page.js";

describe("Burn app", () => {
  it("registers the chip, the panel tab, the thread menu entry, the overlay, the row flags and the Spend page", async () => {
    const app = await loadPluginApp(() => import("../../extensions/bb/app.js"));
    expect(app.threadHeaderActions.map((a) => a.id)).toEqual(["burn-chip"]);
    expect(app.threadPanelActions).toMatchObject([{ id: "burn", title: "Burn", icon: FLAME_ICON }]);
    expect(app.threadActions).toMatchObject([{ id: "cost", title: "Cost", icon: FLAME_ICON }]);
    expect(app.appOverlays.map((o) => o.id)).toEqual(["burn-alerts"]);
    expect(app.contentScripts.map((s) => s.id)).toEqual(["burn-row-flags"]);
    expect(app.navPanels).toMatchObject([{ id: "spend", title: "Burn", icon: FLAME_ICON, path: "spend" }]);
    expect(app.navPanels[0]?.component).toBe(SpendPage);
  });

  it("registers the flame icon its surfaces name, since bb has none", async () => {
    const app = await loadPluginApp(() => import("../../extensions/bb/app.js"));
    expect(app.icons.map((i) => i.name)).toEqual([FLAME_ICON]);
  });
});
