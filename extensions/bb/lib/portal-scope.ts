declare const __BB_PLUGIN_ID__: string | undefined;

type PluginScope = { "data-bb-plugin-root": ""; "data-bb-plugin"?: string };

/**
 * The attributes the build scopes the plugin's Tailwind utilities to. A node
 * the plugin puts outside its slot (a portal, the footer chip) needs them.
 */
export function pluginScopeAttributes(): PluginScope {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-bb-plugin-root": "",
    ...(pluginId !== undefined ? { "data-bb-plugin": pluginId } : {}),
  };
}

export function usePortalScopeProps(): PluginScope & { "data-bb-portaled-overlay": "" } {
  return { "data-bb-portaled-overlay": "", ...pluginScopeAttributes() };
}
