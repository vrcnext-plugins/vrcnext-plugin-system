/**
 * Host entry point.
 *
 * Loaded by the theme script VRCNext injects into its page; the same bundle carries every
 * installed plugin (see `@vrcnext/static-plugins`). Boot is idempotent: VRCNext can re-inject a
 * theme script without a reload, and booting twice would double every listener.
 *
 * Nothing plugin-related happens until the VRCNext Bridge is connected: it holds the enabled
 * flags, the saved grants and every plugin's settings. Until then the Plugins section shows only the
 * Bridge card.
 */

import { COMPILED_PLUGINS } from '@vrcnext/static-plugins';
import { DisposableBag, type Logger, type ToastOptions } from '@vrcnext/plugin-api';

import { API_VERSION } from './api-version.js';
import { PhotinoBridge } from './bridge/photino-bridge.js';
import { ContextMenuHub } from './capabilities/context-menu.js';
import { DeepLinkHub } from './capabilities/deep-links.js';
import { BridgeClient } from './capabilities/native.js';
import { attachRemoteControl } from './capabilities/remote-control.js';
import { RouteTable } from './capabilities/router.js';
import { resolveImageUrl, type BridgeCall } from './capabilities/vrchat/image-urls.js';
import { QuietChannel, photinoCallbacks } from './capabilities/vrchat/quiet-channel.js';
import { HostVrchatApi } from './capabilities/vrchat/vrchat-api.js';
import { EventRouter } from './events/event-router.js';
import { mirrorToActivityLog } from './log/activity-log.js';
import { createLogger } from './log/create-logger.js';
import { DebugHub } from './log/debug-hub.js';
import { LogSink } from './log/log-sink.js';
import { PermissionBroker } from './permissions/broker.js';
import { GrantStore } from './permissions/grant-store.js';
import { readCompiledTable } from './plugins/compiled.js';
import { PluginManager } from './plugins/plugin-manager.js';
import { PluginsService, toBuildResult, toInstalledList } from './plugins/plugins-service.js';
import { BridgeStateService } from './state/state-service.js';
import { AboutPanel } from './ui/about-panel.js';
import { EnableModal } from './ui/enable-modal.js';
import { LogPanel } from './ui/log-panel.js';
import { ManagerPanel } from './ui/manager-panel.js';
import { PermissionModal } from './ui/permission-modal.js';
import { showStartupFailures } from './ui/startup-failures.js';
import { showReloadToast } from './ui/reload-toast.js';
import { PLUGINS_SECTION, SYSTEM_SECTION } from './ui/settings-section.js';
import { UiHost } from './ui/ui-host.js';

const GLOBAL_KEY = '__vrcnextPluginHost';
const BOOT_KEY = '__vrcnextPluginHostBooting';
const THEME_ID = 'vrcnext-plugin-system';

/**
 * What `globalThis.__vrcnextPluginHost` holds, and so what any script on the page — plugins
 * included — can reach. Kept to what is needed: the API version, and `shutdown` for a boot to
 * tell a running host apart and for VRCNext's theme unload. The plugin manager, the bridge
 * client and the rest are not here; the remote-control scope gets the manager on its own.
 */
export interface HostHandle {
  readonly apiVersion: string;
  shutdown(): Promise<void>;
}

function existingHost(): HostHandle | undefined {
  const current: unknown = (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  return typeof current === 'object' && current !== null ? (current as HostHandle) : undefined;
}

/** Routes host messages through VRCNext's own toast renderer, falling back to the log. */
function createToast(sink: LogSink): (options: ToastOptions) => void {
  return ({ message, ok = true }: ToastOptions): void => {
    const show: unknown = (globalThis as { showToast?: unknown }).showToast;
    if (typeof show === 'function') {
      // VRCNext's signature is showToast(ok, msg) — ok first.
      (show as (ok: boolean, msg: string) => void)(ok, message);
      return;
    }
    sink.write(ok ? 'info' : 'warn', 'toast', message, []);
  };
}

interface Core {
  readonly sink: LogSink;
  readonly logger: Logger;
  readonly bridge: PhotinoBridge;
  readonly manager: PluginManager;
  readonly broker: PermissionBroker;
  readonly grants: GrantStore;
  readonly ui: UiHost;
  readonly toast: (options: ToastOptions) => void;
  readonly routes: RouteTable;
  readonly contextMenu: ContextMenuHub;
  readonly native: BridgeClient;
  readonly vrchat: HostVrchatApi;
  readonly quiet: QuietChannel;
  readonly debugHub: DebugHub;
  readonly isLinux: () => boolean;
}

/** VRCNext records the platform on the document before any theme script runs. */
function detectLinux(router: EventRouter, logger: Logger): () => boolean {
  let isLinux =
    (globalThis as { _isLinuxUi?: unknown })._isLinuxUi === true ||
    document.documentElement.classList.contains('linux-ui');
  logger.debug(`Platform at boot: ${isLinux ? 'Linux' : 'Windows'}.`);
  router.on('setPlatform', (payload) => {
    if (typeof payload === 'object' && payload !== null) {
      isLinux = (payload as { isLinux?: unknown }).isLinux === true;
    }
  });
  return (): boolean => isLinux;
}

function buildCore(): Core {
  const sink = new LogSink();
  const logger = createLogger(sink, 'host');
  logger.info(`Starting plugin host, API ${API_VERSION}.`);

  const router = new EventRouter();
  // Wrap VRCNext's own message handler before the host registers its own, so quiet lookups
  // can withhold their replies from VRCNext without touching the host's stream.
  const quiet = new QuietChannel({
    send: (action, args) => { bridge.send(action, args); },
    router,
    callbacks: photinoCallbacks,
  });
  quiet.install();
  const bridge = PhotinoBridge.attach(router);
  // The host's own sends bypass this; only VRCNext's page (the user) comes through here.
  bridge.interceptOutbound((action) => {
    quiet.noteOutbound(action);
    return undefined;
  });
  // The image resolver reads VRCNext's database through the bridge, which is built further down
  // because it needs this sink's logger — and `ui` just below needs `vrchat`. Bound late, the way
  // this file already resolves the broker/manager cycle.
  const late: { call?: BridgeCall } = {};
  const vrchat = new HostVrchatApi({
    router,
    channel: quiet,
    resolveImage: (key) => resolveImageUrl(late.call, key),
  });
  const isLinux = detectLinux(router, logger);
  const toast = createToast(sink);
  const debugHub = new DebugHub(sink);
  const ui = new UiHost({ toast, vrchat, onUiEvent: (action, detail) => { debugHub.logUi(action, detail); } });
  const routes = new RouteTable(globalThis.location.href);
  routes.install();
  const contextMenu = new ContextMenuHub();
  contextMenu.install();

  const native = new BridgeClient(createLogger(sink, 'native'), {
    client: `vrcnext-plugin-system/${API_VERSION}`,
  });
  // Mirror everything logged here into the bridge's log file, so plugin behaviour can be
  // followed with `tail -f` instead of by keeping the Logs panel open and copying text out.
  native.mirrorLogs(sink);

  const call = native.call.bind(native);
  late.call = call;
  const state = new BridgeStateService(call);
  const service = new PluginsService(call);
  const grants = new GrantStore(state);
  // The broker's Uninstall button needs the manager, which needs the broker: bind late.
  const lateManager: { manager?: PluginManager } = {};
  const broker = new PermissionBroker({
    grants,
    prompt: new PermissionModal(),
    onUninstall: async (id) => { await lateManager.manager?.uninstall(id); },
    log: (message) => { logger.info(message); },
  });

  const table = readCompiledTable(COMPILED_PLUGINS);
  for (const error of table.errors) logger.error(`Compiled plugin table: ${error}`);
  logger.info(`Bundle carries ${String(table.plugins.length)} plugin(s).`);

  const manager = new PluginManager({
    compiled: table.plugins,
    context: {
      router,
      bridge,
      state,
      sink,
      ui,
      routes,
      deepLinks: new DeepLinkHub(router),
      contextMenu,
      native,
      vrchat,
      broker,
      isLinux,
      origin: globalThis.location.origin,
    },
    state,
    service,
    broker,
    consent: new EnableModal(),
    logger,
  });
  lateManager.manager = manager;

  return { sink, logger, bridge, manager, broker, grants, ui, toast, routes, contextMenu, native, vrchat, quiet, debugHub, isLinux };
}

/**
 * The host's own UI, built with the same API plugins get: a divider and two Settings sections —
 * Plugin System (bridge, status, logs) and Plugins (install and manage, then every plugin's
 * settings card) — and a "Plugins" shortcut group in the sidebar and the top menu bar.
 */
function mountNav(core: Core, bag: DisposableBag): void {
  const ui = core.ui.forHost(bag);
  ui.addSettingsDivider();
  const system = ui.addSettingsSection({ id: SYSTEM_SECTION, label: 'Plugin System', icon: 'tune' });
  const plugins = ui.addSettingsSection({ id: PLUGINS_SECTION, label: 'Plugins', icon: 'extension' });
  core.ui.pluginsSection = plugins;
  bag.add(() => { core.ui.pluginsSection = undefined; });
  // Everything below this rule is one plugin's own settings section.
  core.ui.setPluginDivider(ui.addSettingsDivider().element);

  const openUrl = (url: string): void => { openUrlVia(core, url); };
  const managerPanel = new ManagerPanel({
    manager: core.manager,
    native: core.native,
    broker: core.broker,
    openUrl,
    openSettings: (id) => core.ui.openSettingsOf(id),
    onError: (message) => {
      core.logger.error(message);
      core.toast({ message, ok: false });
    },
  });
  const logPanel = new LogPanel(core.sink);
  const aboutPanel = new AboutPanel({
    manager: core.manager,
    sink: core.sink,
    native: core.native,
    debugHub: core.debugHub,
    isLinux: core.isLinux,
    openUrl,
  });
  bag.add(() => { managerPanel.dispose(); });
  bag.add(() => { logPanel.dispose(); });
  bag.add(() => { aboutPanel.dispose(); });

  const systemBlock = document.createElement('div');
  aboutPanel.render(systemBlock);
  system.attach(systemBlock);
  const logCard = ui.createCard('Plugin logs', 'article');
  logPanel.render(logCard);
  system.attach(logCard);
  const pluginsBlock = document.createElement('div');
  managerPanel.render(pluginsBlock);
  plugins.attach(pluginsBlock);

  ui.addSidebarGroup({
    id: 'vrcnextPluginsNavGroup',
    label: 'Plugins',
    icon: 'extension',
    entries: [
      { id: 'system', label: 'Plugin System', icon: 'tune', activate: () => { system.open(); } },
      { id: 'plugins', label: 'Plugins', icon: 'extension', activate: () => { plugins.open(); } },
    ],
  });
}

/** VRCNext opens a link in the user's browser; the page itself must not navigate away. */
function openUrlVia(core: Core, url: string): void {
  core.bridge.send('openUrl', { url });
}

/** Once the bridge is connected: read the host state, then activate the enabled plugins. */
function gateOnBridge(core: Core, bag: DisposableBag): void {
  let started = false;
  const start = async (): Promise<void> => {
    if (started) return;
    started = true;
    try {
      await core.grants.load();
      core.broker.loadSaved();
      const failures = await core.manager.start();
      for (const failure of failures) core.logger.error(failure.message, failure.cause);
      if (failures.length > 0) {
        // A dialog rather than a toast: a toast says something is wrong and gives the user
        // nothing to do about it, and this is the one case where there is something to do.
        void showStartupFailures(failures, { openUrl: (url) => { openUrlVia(core, url); } });
      }
      core.logger.info('Plugins started.');
    } catch (error) {
      started = false;
      core.logger.error('Could not read host state from the bridge.', error);
    }
  };
  // Whether the bridge is up is worth saying out loud: without it nothing is installed, no
  // setting is saved and no plugin runs. The state on load is not a transition, so it is not
  // announced — only losing the bridge, and getting it back.
  let wasConnected = core.native.status === 'connected';
  bag.add(core.native.onStatus((status) => {
    const isConnected = status === 'connected';
    if (isConnected !== wasConnected) {
      wasConnected = isConnected;
      core.toast(
        isConnected
          ? { message: 'VRCNext Bridge connected.', ok: true }
          : { message: 'VRCNext Bridge disconnected — plugins and their settings are paused.', ok: false },
      );
    }
    if (isConnected) void start();
  }));
  if (core.native.status === 'connected') void start();

  bag.add(core.native.onPush((event, data) => {
    if (event === 'build') {
      const result = toBuildResult(data);
      if (result.ok) {
        showReloadToast('Rebuilt — reload to apply', () => { globalThis.location.reload(); });
      } else {
        core.logger.error(`The bridge could not rebuild the bundle: ${result.errors.join('\n')}`);
        core.toast({ message: 'Plugin rebuild failed; see the Plugin System section in Settings.', ok: false });
      }
      return;
    }
    if (event === 'plugins') core.manager.setInstalled(toInstalledList(data));
  }));
  void core.native.probe();
}

export function boot(): Promise<HostHandle> {
  const running = existingHost();
  if (running !== undefined) return Promise.resolve(running);

  const inFlight: unknown = (globalThis as Record<string, unknown>)[BOOT_KEY];
  if (inFlight instanceof Promise) return inFlight as Promise<HostHandle>;

  const bootPromise = (async (): Promise<HostHandle> => {
    try {
      const core = buildCore();
      const bag = new DisposableBag();
      // VRCNext's own Activity Log gets every info+ line, so plugin activity reads in one place
      // with the app's own.
      bag.add(mirrorToActivityLog(core.sink));
      mountNav(core, bag);
      gateOnBridge(core, bag);

      const handle: HostHandle = {
        apiVersion: API_VERSION,
        shutdown: async (): Promise<void> => {
          core.debugHub.dispose();
          await core.manager.shutdown();
          core.native.dispose();
          core.vrchat.dispose();
          core.quiet.uninstall();
          core.contextMenu.uninstall();
          core.routes.uninstall();
          bag.dispose();
          core.sink.dispose();
          (globalThis as Record<string, unknown>)[GLOBAL_KEY] = undefined;
        },
      };
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = handle;
      // Only reachable when the bridge runs with `--dev`; otherwise no push ever arrives.
      bag.add(attachRemoteControl({ native: core.native, logger: core.logger, scope: { host: handle, manager: core.manager } }));

      // VRCNext fires this when the user disables the theme.
      document.documentElement.addEventListener(
        `vrcnext:theme:unload:${THEME_ID}`,
        () => { void handle.shutdown(); },
        { once: true },
      );
      core.logger.info('Plugin host ready; waiting for the VRCNext Bridge.');
      return await Promise.resolve(handle);
    } finally {
      (globalThis as Record<string, unknown>)[BOOT_KEY] = undefined;
    }
  })();

  (globalThis as Record<string, unknown>)[BOOT_KEY] = bootPromise;
  return bootPromise;
}

export type { PluginManager } from './plugins/plugin-manager.js';
export { API_VERSION } from './api-version.js';

void boot().catch((error: unknown) => {
  globalThis.console.error('[vrcnext-plugins] boot failed', error);
});
