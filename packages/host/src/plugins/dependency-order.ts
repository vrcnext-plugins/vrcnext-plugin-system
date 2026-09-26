/**
 * Topological ordering so a plugin's dependencies activate before it does.
 *
 * Missing dependencies and cycles are reported as errors and the affected plugins left out,
 * without stopping the unaffected ones.
 */

import type { PluginId, PluginManifest } from '@vrcnext/plugin-api';

export interface OrderResult<T> {
  readonly ordered: readonly T[];
  readonly errors: readonly Error[];
}

export function orderByDependency<T extends { readonly manifest: PluginManifest }>(
  plugins: readonly T[],
): OrderResult<T> {
  const byId = new Map<PluginId, T>();
  for (const plugin of plugins) byId.set(plugin.manifest.id, plugin);

  const errors: Error[] = [];
  const visited = new Set<PluginId>();
  const visiting = new Set<PluginId>();
  const invalid = new Set<PluginId>();
  const ordered: T[] = [];

  function visit(plugin: T): void {
    const { id, name, dependencies = [] } = plugin.manifest;
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(new Error(`Circular dependency involving "${name}" (${id}).`));
      for (const inCycle of visiting) invalid.add(inCycle);
      return;
    }
    visiting.add(id);
    for (const depId of dependencies) {
      const dependency = byId.get(depId);
      if (dependency === undefined) {
        invalid.add(id);
        errors.push(new Error(`"${name}" depends on "${depId}", which is not installed or enabled.`));
        continue;
      }
      visit(dependency);
      if (invalid.has(depId)) invalid.add(id);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(plugin);
  }

  for (const plugin of plugins) visit(plugin);
  return { ordered: ordered.filter((p) => !invalid.has(p.manifest.id)), errors };
}
