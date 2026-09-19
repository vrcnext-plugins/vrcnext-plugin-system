/**
 * Branded identifier types.
 *
 * Every id here has rules of its own (a format, a namespace, a uniqueness scope), so it gets a
 * type of its own rather than travelling as a bare `string` that any other id also fits.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Repo-unique plugin id, e.g. `friend-alerts`. Lowercase kebab-case, 3–64 chars. */
export type PluginId = Brand<string, 'PluginId'>;

/** Globally unique plugin key, `<owner>/<repo>#<pluginId>`. Stable across repo renames of the id. */
export type PluginKey = Brand<string, 'PluginKey'>;

/** A plugin repository source, normalised to `<owner>/<repo>@<ref>`. */
export type RepoId = Brand<string, 'RepoId'>;

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PLUGIN_ID_MIN = 3;
const PLUGIN_ID_MAX = 64;

export function isPluginId(value: string): value is PluginId {
  return (
    value.length >= PLUGIN_ID_MIN &&
    value.length <= PLUGIN_ID_MAX &&
    PLUGIN_ID_PATTERN.test(value)
  );
}

/** Parses a plugin id, returning `undefined` rather than throwing so callers can report context. */
export function parsePluginId(value: string): PluginId | undefined {
  return isPluginId(value) ? value : undefined;
}

export function makePluginKey(repo: RepoId, plugin: PluginId): PluginKey {
  return `${repo}#${plugin}` as PluginKey;
}

export function makeRepoId(owner: string, repo: string, ref: string): RepoId {
  return `${owner}/${repo}@${ref}` as RepoId;
}
