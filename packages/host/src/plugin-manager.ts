/**
 * Ties the registry (what is installed) to the loader (what is running).
 *
 * Every state change persists first and activates second, so a plugin that throws on activate
 * does not leave the stored state disagreeing with what the user sees.
 */

import type { PluginId, PluginKey, RepoId } from '@vrcnext/plugin-api';

import type { PluginLoader } from './loader/plugin-loader.js';
import type { InstalledPlugin, InstalledRepo, Registry } from './registry/registry.js';

export class PluginManager {
  readonly #registry: Registry;
  readonly #loader: PluginLoader;

  constructor(registry: Registry, loader: PluginLoader) {
    this.#registry = registry;
    this.#loader = loader;
  }

  get repos(): readonly InstalledRepo[] {
    return this.#registry.repos;
  }

  get plugins(): readonly InstalledPlugin[] {
    return this.#registry.plugins;
  }

  findInstalled(repoId: RepoId, pluginId: PluginId): InstalledPlugin | undefined {
    return this.#registry.plugins.find(
      (plugin) => plugin.repoId === repoId && plugin.manifest.id === pluginId,
    );
  }

  /** Activates every plugin the user had enabled. One failure must not block the others. */
  async activateEnabled(): Promise<readonly Error[]> {
    const failures: Error[] = [];
    for (const record of this.#registry.enabledPlugins) {
      try {
        await this.#loader.activate(record);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return failures;
  }

  async addRepo(inputUrl: string): Promise<InstalledRepo> {
    return await this.#registry.addRepo(inputUrl);
  }

  async refreshRepo(id: RepoId): Promise<InstalledRepo> {
    return await this.#registry.refreshRepo(id);
  }

  async removeRepo(id: RepoId): Promise<void> {
    for (const plugin of this.#registry.plugins) {
      if (plugin.repoId === id) await this.#loader.deactivate(plugin.key);
    }
    await this.#registry.removeRepo(id);
  }

  async installPlugin(repoId: RepoId, pluginId: PluginId): Promise<InstalledPlugin> {
    return await this.#registry.installPlugin(repoId, pluginId);
  }

  /**
   * Re-downloads an installed plugin and restarts it if it was running. Used by the updater;
   * settings are preserved because they are keyed separately from the bundle.
   */
  async reinstallPlugin(key: PluginKey): Promise<InstalledPlugin> {
    const existing = this.#registry.find(key);
    if (existing === undefined) throw new Error('That plugin is not installed.');

    const wasRunning = this.#loader.isActive(key);
    if (wasRunning) await this.#loader.deactivate(key);

    const record = await this.#registry.installPlugin(existing.repoId, existing.manifest.id);
    if (!wasRunning) return record;

    const enabled = await this.#registry.setEnabled(key, true);
    await this.#loader.activate(enabled);
    return enabled;
  }

  async setEnabled(key: PluginKey, enabled: boolean): Promise<void> {
    const record = await this.#registry.setEnabled(key, enabled);
    if (enabled) {
      try {
        await this.#loader.activate(record);
      } catch (error) {
        // Roll the stored flag back so the UI does not show an enabled plugin that is not running.
        await this.#registry.setEnabled(key, false);
        throw error;
      }
      return;
    }
    await this.#loader.deactivate(key);
  }

  async shutdown(): Promise<void> {
    await this.#loader.deactivateAll();
  }
}
