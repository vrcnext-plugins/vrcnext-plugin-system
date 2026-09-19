/**
 * Evaluates plugin bundles and runs their lifecycle.
 *
 * Bundles are stored as text, so they are evaluated through a blob module URL rather than
 * `eval`: the plugin gets a real module scope, real `import.meta`, and a stack trace that
 * points at its own source instead of at the host.
 *
 * > [!WARNING]
 * > This executes third-party code with the full authority of the VRCNext page — the user's
 * > VRChat session, their webhooks, their settings. The trust decision belongs to the user at
 * > install time; the loader only makes it explicit and reversible.
 */

import {
  DisposableBag,
  type PluginContext,
  type PluginKey,
  type SettingsSchema,
  type VrcnextPlugin,
} from '@vrcnext/plugin-api';
import { satisfies } from 'compare-versions';

import { API_VERSION } from '../api-version.js';
import type { PhotinoBridge } from '../bridge/photino-bridge.js';
import { PluginContextMenuApi, type ContextMenuHub } from '../capabilities/context-menu.js';
import { PluginDeepLinkApi, type DeepLinkHub } from '../capabilities/deep-links.js';
import { HostGameLogApi } from '../capabilities/game-log-api.js';
import { HostOscApi } from '../capabilities/osc-api.js';
import { PluginRouter, type RouteTable } from '../capabilities/router.js';
import { PluginEventBus } from '../events/plugin-event-bus.js';
import type { EventRouter } from '../events/event-router.js';
import { HostNotificationsApi } from '../capabilities/notifications.js';
import { createLogger } from '../log/create-logger.js';
import type { LogSink } from '../log/log-sink.js';
import type { InstalledPlugin } from '../registry/registry.js';
import { PluginSettingsStore } from '../settings/plugin-settings-store.js';
import type { IdbStore } from '../storage/idb-store.js';
import type { UiHost } from '../ui/ui-host.js';

interface ActivePlugin {
  readonly plugin: VrcnextPlugin;
  readonly bag: DisposableBag;
  readonly controller: AbortController;
  readonly revokeUrl: () => void;
}

export interface LoaderDeps {
  readonly router: EventRouter;
  readonly bridge: PhotinoBridge;
  readonly storage: IdbStore;
  readonly sink: LogSink;
  readonly ui: UiHost;
  readonly routes: RouteTable;
  readonly deepLinks: DeepLinkHub;
  readonly contextMenu: ContextMenuHub;
  readonly isLinux: () => boolean;
}

export class PluginLoader {
  readonly #deps: LoaderDeps;
  readonly #active = new Map<PluginKey, ActivePlugin>();

  constructor(deps: LoaderDeps) {
    this.#deps = deps;
  }

  isActive(key: PluginKey): boolean {
    return this.#active.has(key);
  }

  /** Evaluates and activates a plugin. Throws with a user-facing message on any failure. */
  async activate(record: InstalledPlugin): Promise<void> {
    if (this.#active.has(record.key)) return;

    const { apiVersion, id } = record.manifest;
    if (!satisfies(API_VERSION, apiVersion)) {
      throw new Error(
        `"${record.manifest.name}" needs plugin API ${apiVersion}, but this host provides ` +
          `${API_VERSION}. Update the plugin system or the plugin.`,
      );
    }

    const { module, revokeUrl } = await PluginLoader.#evaluate(record);
    const plugin = PluginLoader.#readDefaultExport(module, record);
    if (plugin.id !== id) {
      revokeUrl();
      throw new Error(
        `"${record.manifest.name}" declares id "${plugin.id}" in code but "${id}" in the manifest.`,
      );
    }

    const bag = new DisposableBag();
    const controller = new AbortController();
    bag.add(() => { controller.abort(new Error('Plugin deactivated.')); });

    try {
      const ctx = await this.#buildContext(record, plugin, bag, controller);
      await plugin.activate(ctx);
    } catch (error) {
      bag.dispose();
      revokeUrl();
      throw error instanceof Error ? error : new Error(String(error));
    }

    this.#active.set(record.key, { plugin, bag, controller, revokeUrl });
  }

  async #buildContext(
    record: InstalledPlugin,
    plugin: VrcnextPlugin,
    bag: DisposableBag,
    controller: AbortController,
  ): Promise<PluginContext> {
    const schema: SettingsSchema = plugin.settings ?? {};
    const settings = await PluginSettingsStore.load(schema, record.key, this.#deps.storage);
    const logger = createLogger(this.#deps.sink, record.manifest.id);
    const ui = this.#deps.ui.forPlugin(record, bag);
    bag.add(() => { ui.disposeAll(); });

    const pluginId = record.manifest.id;
    return {
      id: pluginId,
      version: record.manifest.version,
      logger,
      settings,
      events: new PluginEventBus(this.#deps.router, bag),
      bridge: this.#deps.bridge,
      ui,
      notifications: new HostNotificationsApi(this.#deps.bridge, logger, this.#deps.isLinux()),
      osc: new HostOscApi({
        bridge: this.#deps.bridge,
        router: this.#deps.router,
        bag,
        logger,
        available: !this.#deps.isLinux(),
      }),
      gameLog: new HostGameLogApi(this.#deps.bridge, this.#deps.router, bag),
      deepLinks: new PluginDeepLinkApi(this.#deps.deepLinks, bag),
      router: new PluginRouter(this.#deps.routes, pluginId, globalThis.location.origin, (dispose) => {
        bag.add(dispose);
      }),
      contextMenu: new PluginContextMenuApi(this.#deps.contextMenu, pluginId, bag),
      disposables: bag,
      signal: controller.signal,
    };
  }

  static async #evaluate(
    record: InstalledPlugin,
  ): Promise<{ readonly module: unknown; readonly revokeUrl: () => void }> {
    const blob = new Blob([record.source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const revokeUrl = (): void => { URL.revokeObjectURL(url); };
    try {
      const module: unknown = await import(/* @vite-ignore */ url);
      return { module, revokeUrl };
    } catch (error) {
      revokeUrl();
      throw new Error(
        `"${record.manifest.name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static #readDefaultExport(
    module: unknown,
    record: InstalledPlugin,
  ): VrcnextPlugin {
    if (typeof module !== 'object' || module === null) {
      throw new Error(`"${record.manifest.name}" did not evaluate to a module.`);
    }
    const candidate = (module as { default?: unknown }).default;
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      typeof (candidate as VrcnextPlugin).id !== 'string' ||
      typeof (candidate as VrcnextPlugin).activate !== 'function'
    ) {
      throw new Error(
        `"${record.manifest.name}" must default-export a plugin with an "id" and "activate".`,
      );
    }
    return candidate as VrcnextPlugin;
  }

  async deactivate(key: PluginKey): Promise<void> {
    const active = this.#active.get(key);
    if (active === undefined) return;
    this.#active.delete(key);

    try {
      await active.plugin.deactivate?.();
    } catch (error) {
      globalThis.console.error('[vrcnext-plugins] deactivate threw', error);
    } finally {
      active.bag.dispose();
      active.revokeUrl();
    }
  }

  async deactivateAll(): Promise<void> {
    await Promise.all([...this.#active.keys()].map((key) => this.deactivate(key)));
  }
}
