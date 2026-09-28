/**
 * What is installed, what is enabled, what is running.
 *
 * Three sets that can legitimately differ:
 *
 * - **compiled**: the plugins in this bundle, from `@vrcnext/static-plugins`. Fixed for the life
 *   of the page.
 * - **installed**: the clones the bridge has, from `plugins/list`. Changes when the user installs
 *   or uninstalls; a plugin installed since the page loaded is here but not compiled until the
 *   next reload.
 * - **enabled**: flags in the bridge's state store, ns `host`, key `enabled:<id>`.
 *
 * Every state change persists first and activates second, so a plugin that throws on activate
 * does not leave the stored flag disagreeing with what the user sees.
 */

import { satisfies, type Logger, type PluginId, type PluginManifest } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';
import type { PermissionBroker } from '../permissions/broker.js';
import { HOST_NS, type StateService } from '../state/state-service.js';
import type { CompiledPlugin } from './compiled.js';
import { issueReport } from './report-issue.js';
import { PluginStartupError } from './startup-error.js';
import { createContext, type BuiltContext, type ContextDeps } from './context.js';
import { orderByDependency } from './dependency-order.js';
import type { InstalledPlugin, PluginUpdate, PluginsService, TrustedKey } from './plugins-service.js';

const ENABLED_PREFIX = 'enabled:';

/** The enable modal: categories with their tone, plus the declared targets. */
export interface EnableConsent {
  ask(manifest: PluginManifest): Promise<boolean>;
}

export interface ManagerDeps {
  readonly compiled: readonly CompiledPlugin[];
  readonly context: ContextDeps;
  readonly state: StateService;
  readonly service: PluginsService;
  readonly broker: PermissionBroker;
  readonly consent: EnableConsent;
  readonly logger: Logger;
}

export class PluginManager {
  readonly #deps: ManagerDeps;
  readonly #enabled = new Set<PluginId>();
  readonly #active = new Map<PluginId, BuiltContext & { readonly plugin: CompiledPlugin }>();
  #installed: readonly InstalledPlugin[] = [];
  #updates: readonly PluginUpdate[] = [];
  readonly #listeners = new Set<() => void>();

  constructor(deps: ManagerDeps) {
    this.#deps = deps;
  }

  get compiled(): readonly CompiledPlugin[] {
    return this.#deps.compiled;
  }

  get installed(): readonly InstalledPlugin[] {
    return this.#installed;
  }

  get updates(): readonly PluginUpdate[] {
    return this.#updates;
  }

  compiledById(id: PluginId): CompiledPlugin | undefined {
    return this.#deps.compiled.find((p) => p.manifest.id === id);
  }

  isEnabled(id: PluginId): boolean {
    return this.#enabled.has(id);
  }

  isActive(id: PluginId): boolean {
    return this.#active.has(id);
  }

  /** Be told after anything the manager panel shows has changed. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return (): void => { this.#listeners.delete(listener); };
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Read the enabled flags, activate those plugins in dependency order, then list the clones. */
  async start(): Promise<readonly Error[]> {
    const entries = await this.#deps.state.list(HOST_NS);
    for (const [key, value] of Object.entries(entries)) {
      if (key.startsWith(ENABLED_PREFIX) && value === true) {
        this.#enabled.add(key.slice(ENABLED_PREFIX.length) as PluginId);
      }
    }

    const wanted = this.#deps.compiled.filter((p) => this.#enabled.has(p.manifest.id));
    const { ordered, errors } = orderByDependency(wanted);
    const failures: Error[] = [...errors];
    for (const plugin of ordered) {
      try {
        await this.#activate(plugin);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.#changed();
    void this.refreshInstalled();
    return failures;
  }

  /**
   * Start a plugin, whatever API version it asked for.
   *
   * A declared range is what the author last tested against, not a statement that anything is
   * broken. Refusing on a mismatch turned every host release into a day where working plugins
   * stopped working for no reason anyone could see — the plugin was fine, and the user was told
   * to wait for an update it did not need. So the range is a warning, the plugin runs, and only
   * an actual failure is treated as one.
   */
  async #activate(compiled: CompiledPlugin): Promise<void> {
    const { manifest, plugin } = compiled;
    if (this.#active.has(manifest.id)) return;
    const untested = !satisfies(API_VERSION, manifest.apiVersion);
    if (untested) {
      this.#deps.logger.warn(
        `"${manifest.name}" was written for plugin API ${manifest.apiVersion} and this host ` +
          `provides ${API_VERSION}. Starting it anyway; it will be reported if it fails.`,
      );
    }
    const built = await createContext(this.#deps.context, manifest, plugin);
    try {
      await plugin.activate(built.ctx);
    } catch (error) {
      built.bag.dispose();
      throw this.#startupFailure(manifest, error, untested);
    }
    this.#active.set(manifest.id, { ...built, plugin: compiled });
    this.#deps.logger.info(`Activated ${manifest.name} v${manifest.version}.`);
  }

  /**
   * What the user is told when a plugin throws on the way up.
   *
   * The version range only enters the message here, where something has actually gone wrong —
   * and then it is the most likely explanation, so it is worth saying along with who to tell.
   */
  #startupFailure(manifest: PluginManifest, error: unknown, untested: boolean): PluginStartupError {
    const cause = error instanceof Error ? error : new Error(String(error));
    const why = untested
      ? `"${manifest.name}" did not start. It was written for plugin API ${manifest.apiVersion} ` +
        `and this host provides ${API_VERSION}, which is the likely cause. Wait for an update, ` +
        'or tell its author.'
      : `"${manifest.name}" did not start.`;
    const failure = new PluginStartupError(why, manifest, cause);
    const report = issueReport(manifest, cause);
    if (report !== undefined) failure.report = report;
    return failure;
  }

  async #deactivate(id: PluginId): Promise<void> {
    const active = this.#active.get(id);
    if (active === undefined) return;
    this.#active.delete(id);
    try {
      await active.plugin.plugin.deactivate?.();
    } catch (error) {
      this.#deps.logger.error(`${id}: deactivate threw`, error);
    } finally {
      active.bag.dispose();
      await active.settings.flush();
    }
  }

  /**
   * Enable or disable. Enabling shows the consent modal; a decline leaves the plugin disabled
   * and resolves `false`. Dependencies must already be enabled — they are not switched on
   * silently, because each carries its own consent.
   */
  async setEnabled(id: PluginId, enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.#enabled.delete(id);
      await this.#deps.state.delete(HOST_NS, `${ENABLED_PREFIX}${id}`);
      await this.#deactivate(id);
      this.#changed();
      return true;
    }

    const compiled = this.compiledById(id);
    if (compiled === undefined) {
      throw new Error('That plugin is not in this bundle yet. Reload VRCNext to pick it up.');
    }
    for (const dependency of compiled.manifest.dependencies ?? []) {
      if (!this.#active.has(dependency)) {
        throw new Error(`Enable "${dependency}" first; "${compiled.manifest.name}" depends on it.`);
      }
    }
    if (!(await this.#deps.consent.ask(compiled.manifest))) return false;

    this.#enabled.add(id);
    await this.#deps.state.set(HOST_NS, `${ENABLED_PREFIX}${id}`, true);
    try {
      await this.#activate(compiled);
    } catch (error) {
      // Roll the stored flag back so the UI does not show an enabled plugin that is not running.
      this.#enabled.delete(id);
      await this.#deps.state.delete(HOST_NS, `${ENABLED_PREFIX}${id}`);
      throw error;
    }
    this.#changed();
    return true;
  }

  async refreshInstalled(): Promise<void> {
    try {
      this.#installed = await this.#deps.service.list();
    } catch (error) {
      this.#deps.logger.warn('Could not list installed plugins.', error);
    }
    this.#changed();
  }

  /** The bridge pushed a new installed set. */
  setInstalled(list: readonly InstalledPlugin[]): void {
    this.#installed = list;
    this.#changed();
  }

  async checkUpdates(): Promise<readonly PluginUpdate[]> {
    this.#updates = await this.#deps.service.checkUpdates();
    this.#changed();
    return this.#updates;
  }

  async install(url: string): Promise<void> {
    await this.#deps.service.install(url);
    await this.refreshInstalled();
  }

  async update(id: PluginId): Promise<void> {
    await this.#deps.service.update(id);
    this.#updates = this.#updates.filter((u) => u.id !== id);
    await this.refreshInstalled();
  }

  /** One at a time: the bridge confirms each on the desktop. Stops at the first failure. */
  async updateAll(): Promise<void> {
    for (const update of [...this.#updates]) await this.update(update.id);
  }

  /** The signing keys this machine has accepted. Read straight through; nothing is cached. */
  async keys(): Promise<readonly TrustedKey[]> {
    return this.#deps.service.keys();
  }

  /** Stop trusting a key. Confirmed on the desktop; nothing is uninstalled. */
  async forgetKey(keyId: string): Promise<void> {
    await this.#deps.service.forgetKey(keyId);
    this.#changed();
  }

  async uninstall(id: PluginId): Promise<void> {
    await this.#deps.service.uninstall(id);
    this.#enabled.delete(id);
    await this.#deps.state.delete(HOST_NS, `${ENABLED_PREFIX}${id}`);
    await this.#deactivate(id);
    await this.#deps.broker.forgetAll(id);
    this.#updates = this.#updates.filter((u) => u.id !== id);
    await this.refreshInstalled();
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#active.keys()].map((id) => this.#deactivate(id)));
  }
}
