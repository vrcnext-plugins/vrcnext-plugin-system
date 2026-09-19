/**
 * Installed repositories and plugins.
 *
 * Owns persistence and the install/uninstall/enable lifecycle. It deliberately knows nothing
 * about executing plugin code — the loader does that — so this stays unit-testable.
 */

import {
  makePluginKey,
  type PluginId,
  type PluginKey,
  type PluginManifest,
  type RepoId,
} from '@vrcnext/plugin-api';

import { STORES, type IdbStore } from '../storage/idb-store.js';
import { fetchPluginBundle, fetchRepoManifest } from './repo-client.js';
import { parseRepoSource, type RepoSource } from './repo-source.js';

export interface InstalledRepo {
  readonly id: RepoId;
  /** The URL exactly as the user typed it, so the UI can show what they entered. */
  readonly inputUrl: string;
  readonly name: string;
  readonly homepage: string;
  readonly addedAt: number;
  readonly lastSyncedAt: number | undefined;
  readonly plugins: readonly PluginManifest[];
}

export interface InstalledPlugin {
  readonly key: PluginKey;
  readonly repoId: RepoId;
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly installedAt: number;
  readonly source: string;
}

interface RepoRecord extends InstalledRepo {
  readonly inputUrl: string;
}

export class Registry {
  readonly #storage: IdbStore;
  #repos = new Map<RepoId, RepoRecord>();
  #plugins = new Map<PluginKey, InstalledPlugin>();

  constructor(storage: IdbStore) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    const repoEntries = await this.#storage.entries<RepoRecord>(STORES.repos);
    this.#repos = new Map(repoEntries.map(([, record]) => [record.id, record]));

    const pluginEntries = await this.#storage.entries<InstalledPlugin>(STORES.plugins);
    this.#plugins = new Map(pluginEntries.map(([, record]) => [record.key, record]));
  }

  get repos(): readonly InstalledRepo[] {
    return [...this.#repos.values()];
  }

  get plugins(): readonly InstalledPlugin[] {
    return [...this.#plugins.values()];
  }

  get enabledPlugins(): readonly InstalledPlugin[] {
    return this.plugins.filter((plugin) => plugin.enabled);
  }

  find(key: PluginKey): InstalledPlugin | undefined {
    return this.#plugins.get(key);
  }

  /**
   * Adds a repository and records every plugin it offers. Nothing is downloaded or enabled
   * yet — the user picks which plugins to install from the listing.
   */
  async addRepo(inputUrl: string, signal?: AbortSignal): Promise<InstalledRepo> {
    const { source, error } = parseRepoSource(inputUrl);
    if (source === undefined) throw new Error(error ?? 'The repository URL is invalid.');
    if (this.#repos.has(source.id)) throw new Error('That repository has already been added.');

    const record = await this.#syncRepo(source, inputUrl, Date.now(), signal);
    return record;
  }

  /** Re-reads a repository's manifest, picking up new plugins and version bumps. */
  async refreshRepo(id: RepoId, signal?: AbortSignal): Promise<InstalledRepo> {
    const existing = this.#repos.get(id);
    if (existing === undefined) throw new Error('That repository is not installed.');

    const { source, error } = parseRepoSource(existing.inputUrl);
    if (source === undefined) throw new Error(error ?? 'The stored repository URL is invalid.');

    return await this.#syncRepo(source, existing.inputUrl, existing.addedAt, signal);
  }

  async #syncRepo(
    source: RepoSource,
    inputUrl: string,
    addedAt: number,
    signal?: AbortSignal,
  ): Promise<RepoRecord> {
    const { manifest } = await fetchRepoManifest(source, signal);
    const record: RepoRecord = {
      id: source.id,
      inputUrl,
      name: manifest.name,
      homepage: source.homepage.href,
      addedAt,
      lastSyncedAt: Date.now(),
      plugins: manifest.plugins,
    };
    await this.#storage.set(STORES.repos, source.id, record);
    this.#repos.set(source.id, record);
    return record;
  }

  async removeRepo(id: RepoId): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.repoId === id) await this.uninstallPlugin(plugin.key);
    }
    await this.#storage.delete(STORES.repos, id);
    this.#repos.delete(id);
  }

  /** Downloads a plugin's bundle and records it as installed, disabled by default. */
  async installPlugin(
    repoId: RepoId,
    pluginId: PluginId,
    signal?: AbortSignal,
  ): Promise<InstalledPlugin> {
    const repo = this.#repos.get(repoId);
    if (repo === undefined) throw new Error('That repository is not installed.');

    const manifest = repo.plugins.find((p) => p.id === pluginId);
    if (manifest === undefined) throw new Error('That plugin is not offered by the repository.');

    const { source, error } = parseRepoSource(repo.inputUrl);
    if (source === undefined) throw new Error(error ?? 'The stored repository URL is invalid.');

    const code = await fetchPluginBundle(source, manifest.entry, signal);
    const record: InstalledPlugin = {
      key: makePluginKey(repoId, pluginId),
      repoId,
      manifest,
      enabled: false,
      installedAt: Date.now(),
      source: code,
    };
    await this.#storage.set(STORES.plugins, record.key, record);
    this.#plugins.set(record.key, record);
    return record;
  }

  async setEnabled(key: PluginKey, enabled: boolean): Promise<InstalledPlugin> {
    const existing = this.#plugins.get(key);
    if (existing === undefined) throw new Error('That plugin is not installed.');

    const updated: InstalledPlugin = { ...existing, enabled };
    await this.#storage.set(STORES.plugins, key, updated);
    this.#plugins.set(key, updated);
    return updated;
  }

  async uninstallPlugin(key: PluginKey): Promise<void> {
    await this.#storage.delete(STORES.plugins, key);
    await this.#storage.delete(STORES.settings, key);
    this.#plugins.delete(key);
  }
}
