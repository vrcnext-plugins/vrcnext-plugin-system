/**
 * Plugin repository manifest.
 *
 * A repo publishes one `vrcnext-plugins.json` at its root describing every plugin it houses, so
 * a single repo URL can offer many plugins. The file is fetched from an untrusted host, so it is
 * parsed defensively: unknown fields are ignored, and one malformed entry does not discard the
 * rest of the manifest.
 */

import { parsePluginId, type PluginId } from './ids.js';

/** Bumped only on a breaking change to this file's shape. */
export const MANIFEST_FORMAT_VERSION = 1;

/** Manifest file expected at the root of a plugin repository. */
export const MANIFEST_FILENAME = 'vrcnext-plugins.json';

export interface PluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Repo-relative path to the built ESM entry point, e.g. `dist/friend-alerts.js`. */
  readonly entry: string;
  /** Semver range of `@vrcnext/plugin-api` this plugin was built against. */
  readonly apiVersion: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly icon?: string;
}

export interface RepoManifest {
  readonly formatVersion: number;
  readonly name: string;
  readonly plugins: readonly PluginManifest[];
}

export interface ManifestParseResult {
  readonly manifest: RepoManifest | undefined;
  /** Human-readable problems. Non-empty with a defined manifest means entries were skipped. */
  readonly errors: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Rejects entry paths that escape the repo root or point at an absolute/remote location.
 * The entry is later joined onto a raw-content URL, so a `..` segment would fetch from an
 * unrelated repository.
 */
function asSafeEntryPath(value: unknown): string | undefined {
  const raw = asNonEmptyString(value);
  if (raw === undefined) return undefined;
  if (raw.startsWith('/') || raw.includes('://') || raw.includes('\\')) return undefined;
  const segments = raw.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s.length === 0)) return undefined;
  return raw;
}

function parsePlugin(value: unknown, index: number, errors: string[]): PluginManifest | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    errors.push(`plugins[${String(index)}] is not an object.`);
    return undefined;
  }

  const id = parsePluginId(asNonEmptyString(record['id']) ?? '');
  const name = asNonEmptyString(record['name']);
  const version = asNonEmptyString(record['version']);
  const entry = asSafeEntryPath(record['entry']);
  const apiVersion = asNonEmptyString(record['apiVersion']);

  const label = id ?? `plugins[${String(index)}]`;
  if (id === undefined) errors.push(`${label}: missing or malformed "id".`);
  if (name === undefined) errors.push(`${label}: missing "name".`);
  if (version === undefined) errors.push(`${label}: missing "version".`);
  if (entry === undefined) errors.push(`${label}: missing or unsafe "entry" path.`);
  if (apiVersion === undefined) errors.push(`${label}: missing "apiVersion".`);

  if (
    id === undefined ||
    name === undefined ||
    version === undefined ||
    entry === undefined ||
    apiVersion === undefined
  ) {
    return undefined;
  }

  const author = asNonEmptyString(record['author']);
  const homepage = asNonEmptyString(record['homepage']);
  const icon = asNonEmptyString(record['icon']);

  return {
    id,
    name,
    version,
    entry,
    apiVersion,
    description: asNonEmptyString(record['description']) ?? '',
    ...(author !== undefined ? { author } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(icon !== undefined ? { icon } : {}),
  };
}

export function parseRepoManifest(raw: unknown): ManifestParseResult {
  const errors: string[] = [];
  const record = asRecord(raw);
  if (record === undefined) {
    return { manifest: undefined, errors: [`${MANIFEST_FILENAME} is not a JSON object.`] };
  }

  const formatVersion = record['formatVersion'];
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    return { manifest: undefined, errors: ['"formatVersion" must be an integer.'] };
  }
  if (formatVersion > MANIFEST_FORMAT_VERSION) {
    return {
      manifest: undefined,
      errors: [
        `Manifest format ${String(formatVersion)} is newer than supported ` +
          `(${String(MANIFEST_FORMAT_VERSION)}). Update the plugin system.`,
      ],
    };
  }

  const rawPlugins = record['plugins'];
  if (!Array.isArray(rawPlugins)) {
    return { manifest: undefined, errors: ['"plugins" must be an array.'] };
  }

  const plugins: PluginManifest[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of rawPlugins.entries()) {
    const plugin = parsePlugin(entry, index, errors);
    if (plugin === undefined) continue;
    if (seen.has(plugin.id)) {
      errors.push(`${plugin.id}: duplicate id in manifest, later entry ignored.`);
      continue;
    }
    seen.add(plugin.id);
    plugins.push(plugin);
  }

  return {
    manifest: {
      formatVersion,
      name: asNonEmptyString(record['name']) ?? 'Unnamed repository',
      plugins,
    },
    errors,
  };
}
