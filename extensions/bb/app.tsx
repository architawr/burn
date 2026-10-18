import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { BurnHeaderAction } from "./chip.js";

export default definePluginApp((app) => {
  // Not a prompt-box action: bb mounts those for only three plugins. The chip moves itself into the footer.
  app.slots.experimental_threadHeaderAction({ id: "burn-chip", title: "Burn", component: BurnHeaderAction });
});
