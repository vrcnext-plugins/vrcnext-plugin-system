/**
 * Builds the {@link PluginContext} one plugin sees.
 *
 * Every capability that reaches beyond the plugin's own panels and settings goes through a gate
 * built for that plugin: the category ceiling from its `plugin.json`, and the broker for the
 * concrete target. `ui`, `settings`, `logger` and `disposables` are handed over as they are.
 */

import {
  DisposableBag,
  type PluginContext,
  type PluginManifest,
  type SettingsSchema,
  type VrchatApi,
  type VrcnextPlugin,
} from '@vrcnext/plugin-api';

import type { PhotinoBridge } from '../bridge/photino-bridge.js';
import { PluginContextMenuApi, type ContextMenuHub } from '../capabilities/context-menu.js';
import { PluginDeepLinkApi, type DeepLinkHub } from '../capabilities/deep-links.js';
import { HostGameLogApi } from '../capabilities/game-log-api.js';
import type { BridgeClient } from '../capabilities/native.js';
import { HostNotificationsApi } from '../capabilities/notifications.js';
import { HostOscApi } from '../capabilities/osc-api.js';
import { PluginRouter, type RouteTable } from '../capabilities/router.js';
import type { EventRouter } from '../events/event-router.js';
import { createLogger } from '../log/create-logger.js';
import type { LogSink } from '../log/log-sink.js';
import type { PermissionBroker } from '../permissions/broker.js';
import { PluginGate } from '../permissions/plugin-gate.js';
import { PluginSettingsStore } from '../settings/plugin-settings-store.js';
import { pluginNs, type StateService } from '../state/state-service.js';
import type { UiHost } from '../ui/ui-host.js';
import {
  categoryGuarded,
  GatedBridge,
  GatedClipboard,
  GatedDeepLinks,
  GatedEventBus,
  GatedGameLog,
  GatedHttp,
  GatedNative,
  GatedOsc,
  gatedVrchat,
} from './gated.js';

export interface ContextDeps {
  readonly router: EventRouter;
  readonly bridge: PhotinoBridge;
  readonly state: StateService;
  readonly sink: LogSink;
  readonly ui: UiHost;
  readonly routes: RouteTable;
  readonly deepLinks: DeepLinkHub;
  readonly contextMenu: ContextMenuHub;
  readonly native: BridgeClient;
  readonly vrchat: VrchatApi;
  readonly broker: PermissionBroker;
  readonly isLinux: () => boolean;
  /** Page origin for the plugin router's base URL. */
  readonly origin: string;
}

export interface BuiltContext {
  readonly ctx: PluginContext;
  readonly bag: DisposableBag;
  readonly gate: PluginGate;
  readonly settings: PluginSettingsStore<SettingsSchema>;
}

export async function createContext(
  deps: ContextDeps,
  manifest: PluginManifest,
  plugin: VrcnextPlugin,
): Promise<BuiltContext> {
  const bag = new DisposableBag();
  const controller = new AbortController();
  bag.add(() => { controller.abort(new Error('Plugin deactivated.')); });

  const logger = createLogger(deps.sink, manifest.id);
  const gate = new PluginGate(manifest, deps.broker, logger, controller.signal);
  gate.seedDeclared();

  const schema: SettingsSchema = plugin.settings ?? {};
  const settings = await PluginSettingsStore.load(schema, pluginNs(manifest.id), deps.state, (error) => {
    logger.error('Could not save a setting to the bridge.', error);
  });
  bag.add(() => { void settings.flush(); });

  const vrchat = gatedVrchat(deps.vrchat, gate);
  const ui = deps.ui.forPlugin({ id: manifest.id, name: manifest.name, bag, settings, schema, vrchat });
  bag.add(() => { ui.disposeAll(); });

  const osc = new HostOscApi({
    bridge: deps.bridge,
    router: deps.router,
    bag,
    logger,
    available: !deps.isLinux(),
  });
  const router = new PluginRouter(deps.routes, manifest.id, deps.origin, (dispose) => { bag.add(dispose); });

  const ctx: PluginContext = {
    id: manifest.id,
    version: manifest.version,
    logger,
    settings,
    permissions: gate,
    events: new GatedEventBus(deps.router, bag, gate),
    bridge: new GatedBridge(deps.bridge, gate, bag),
    ui,
    notifications: categoryGuarded(
      gate,
      'notifications',
      new HostNotificationsApi(deps.bridge, logger, deps.isLinux()),
    ),
    osc: new GatedOsc(osc, gate, bag),
    native: new GatedNative(deps.native, gate),
    gameLog: new GatedGameLog(new HostGameLogApi(deps.bridge, deps.router, bag), gate, bag),
    vrchat,
    deepLinks: new GatedDeepLinks(new PluginDeepLinkApi(deps.deepLinks, bag), gate, bag),
    router: categoryGuarded(gate, 'routes', router),
    contextMenu: categoryGuarded(
      gate,
      'context-menu',
      new PluginContextMenuApi(deps.contextMenu, manifest.id, bag),
    ),
    http: new GatedHttp(gate, controller.signal, deps.native),
    clipboard: new GatedClipboard(gate),
    disposables: bag,
    signal: controller.signal,
  };
  return { ctx, bag, gate, settings };
}
