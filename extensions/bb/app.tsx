import "./app.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { BurnHeaderAction } from "./chip.js";
import { mountRowFlags } from "./flags.js";
import { FLAME_ICON, FlameIcon } from "./icon.js";
import { costActionRegistration } from "./menu.js";
import { BurnOverlay } from "./overlay.js";
import { BurnPanel } from "./panel.js";
import { PANEL_ACTION_ID } from "./panel-requests.js";
import { SpendPage } from "./spend/page.js";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: FLAME_ICON, component: FlameIcon });
  // Not a prompt-box action: bb mounts those for only three plugins. The chip moves itself into the footer.
  app.slots.experimental_threadHeaderAction({ id: "burn-chip", title: "Burn", component: BurnHeaderAction });
  app.slots.threadPanelAction({ id: PANEL_ACTION_ID, title: "Burn", icon: FLAME_ICON, component: BurnPanel });
  app.slots.experimental_threadAction(costActionRegistration);
  app.slots.experimental_appOverlay({ id: "burn-alerts", component: BurnOverlay });
  app.contentScripts.register({ id: "burn-row-flags", mount: mountRowFlags });
  app.slots.navPanel({ id: "spend", title: "Burn", icon: FLAME_ICON, path: "spend", component: SpendPage });
});
