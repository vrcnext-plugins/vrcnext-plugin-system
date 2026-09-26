/**
 * The compiled plugin table.
 *
 * The bridge generates `build/static-plugins.ts`, one import pair per installed plugin, and
 * bundles it with the host as `@vrcnext/static-plugins`. Its manifests were validated at
 * install, but the host validates again: the table is data from a file on disk, and a stale or
 * hand-edited one should fail with a message, not a stack trace.
 */

import {
  parsePluginManifest,
  type PluginManifest,
  type VrcnextPlugin,
} from '@vrcnext/plugin-api';

export interface CompiledPlugin {
  readonly manifest: PluginManifest;
  readonly plugin: VrcnextPlugin;
}

export interface CompiledTable {
  readonly plugins: readonly CompiledPlugin[];
  /** One line per entry the table had to drop, for the log. */
  readonly errors: readonly string[];
}

function isPlugin(value: unknown): value is VrcnextPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { activate?: unknown }).activate === 'function'
  );
}

export function readCompiledTable(raw: unknown): CompiledTable {
  if (!Array.isArray(raw)) {
    return { plugins: [], errors: ['The compiled plugin table is not an array.'] };
  }
  const plugins: CompiledPlugin[] = [];
  const errors: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const label = `entry ${String(index)}`;
    const manifestRaw = (entry as { manifest?: unknown } | null)?.manifest;
    const pluginRaw = (entry as { plugin?: unknown } | null)?.plugin;
    const { manifest, errors: manifestErrors } = parsePluginManifest(manifestRaw);
    if (manifest === undefined) {
      errors.push(`${label}: ${manifestErrors.join(' ')}`);
      continue;
    }
    if (!isPlugin(pluginRaw)) {
      errors.push(`${manifest.id}: main.ts must default-export a plugin with "id" and "activate".`);
      continue;
    }
    if (pluginRaw.id !== manifest.id) {
      errors.push(`${manifest.id}: main.ts declares id "${pluginRaw.id}" but plugin.json says "${manifest.id}".`);
      continue;
    }
    if (plugins.some((p) => p.manifest.id === manifest.id)) {
      errors.push(`${manifest.id}: listed twice in the compiled table.`);
      continue;
    }
    plugins.push({ manifest, plugin: pluginRaw });
  }
  return { plugins, errors };
}
