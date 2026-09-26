/**
 * The plugin id.
 *
 * One id names three things that must agree: the `id` field in `plugin.json`, the `id` on the
 * `definePlugin` object, and the clone directory `~/.vrcnext-plugins/plugins/<id>`. Because it
 * becomes a filesystem path on the bridge, the format is deliberately narrow and the bridge
 * applies the same rule before touching disk.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Lowercase, `[a-z0-9][a-z0-9-]{1,39}`. */
export type PluginId = Brand<string, 'PluginId'>;

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function isPluginId(value: string): value is PluginId {
  return PLUGIN_ID_PATTERN.test(value);
}

/** Parses a plugin id, returning `undefined` rather than throwing so callers can report context. */
export function parsePluginId(value: string): PluginId | undefined {
  return isPluginId(value) ? value : undefined;
}
