/**
 * Topological sorting and dependency validation for plugins.
 */

import type { PluginId } from '@vrcnext/plugin-api';
import type { InstalledPlugin } from '../registry/registry.js';

export interface OrderResult {
  readonly ordered: readonly InstalledPlugin[];
  readonly errors: readonly Error[];
}

/**
 * Orders enabled plugins topologically so that dependencies are activated before the plugins
 * that depend on them.
 *
 * Missing dependencies and circular dependency cycles are captured as errors without crashing
 * unaffected plugins.
 */
export function orderPluginsByDependency(plugins: readonly InstalledPlugin[]): OrderResult {
  const byId = new Map<PluginId, InstalledPlugin>();
  for (const plugin of plugins) {
    byId.set(plugin.manifest.id, plugin);
  }

  const errors: Error[] = [];
  const visited = new Set<PluginId>();
  const visiting = new Set<PluginId>();
  const invalidIds = new Set<PluginId>();
  const ordered: InstalledPlugin[] = [];

  function visit(plugin: InstalledPlugin): void {
    const id = plugin.manifest.id;
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(new Error(`Circular dependency detected involving plugin "${plugin.manifest.name}" (${id}).`));
      for (const cycleId of visiting) {
        invalidIds.add(cycleId);
      }
      return;
    }

    visiting.add(id);

    const deps = plugin.manifest.dependencies ?? [];
    for (const depId of deps) {
      const depPlugin = byId.get(depId);
      if (depPlugin === undefined) {
        invalidIds.add(id);
        errors.push(
          new Error(
            `Plugin "${plugin.manifest.name}" depends on "${depId}", which is not installed or enabled.`,
          ),
        );
      } else {
        visit(depPlugin);
      }
    }

    visiting.delete(id);
    visited.add(id);
    ordered.push(plugin);
  }

  for (const plugin of plugins) {
    if (!visited.has(plugin.manifest.id)) {
      visit(plugin);
    }
  }

  const runnable = ordered.filter((p) => !invalidIds.has(p.manifest.id));

  return { ordered: runnable, errors };
}
