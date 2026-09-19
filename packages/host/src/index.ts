/**
 * Host entry point.
 *
 * Loaded by the bootstrap theme VRCNext injects into its page. Boot is idempotent: VRCNext can
 * re-inject a theme script without a reload, and booting twice would double every listener.
 */

import { DisposableBag, type Logger, type ToastOptions } from '@vrcnext/plugin-api';

import { API_VERSION } from './api-version.js';
import { PhotinoBridge } from './bridge/photino-bridge.js';
import { ContextMenuHub } from './capabilities/context-menu.js';
import { DeepLinkHub } from './capabilities/deep-links.js';
import { RouteTable } from './capabilities/router.js';
import { EventRouter } from './events/event-router.js';
import { PluginLoader } from './loader/plugin-loader.js';
import { createLogger } from './log/create-logger.js';
import { LogSink } from './log/log-sink.js';
import { PluginManager } from './plugin-manager.js';
import { Registry } from './registry/registry.js';
import { IdbStore } from './storage/idb-store.js';
import { LogPanel } from './ui/log-panel.js';
import { ManagerPanel } from './ui/manager-panel.js';
import { UiHost } from './ui/ui-host.js';
import { Updater } from './update/updater.js';

const GLOBAL_KEY = '__vrcnextPluginHost';
const THEME_ID = 'vrcnext-plugin-system';

export interface HostHandle {
  readonly apiVersion: string;
  readonly manager: PluginManager;
  readonly updater: Updater;
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
      (show as (msg: string, ok: boolean) => void)(message, ok);
      return;
    }
    sink.write(ok ? 'info' : 'warn', 'toast', message, []);
  };
}

/** Wires the shared services every capability hangs off. */
interface Core {
  readonly sink: LogSink;
  readonly logger: Logger;
  readonly router: EventRouter;
  readonly bridge: PhotinoBridge;
  readonly storage: IdbStore;
  readonly manager: PluginManager;
  readonly ui: UiHost;
  readonly toast: (options: ToastOptions) => void;
  readonly routes: RouteTable;
  readonly contextMenu: ContextMenuHub;
}

async function buildCore(): Promise<Core> {
  const sink = new LogSink();
  const logger = createLogger(sink, 'host');
  logger.info(`Starting plugin host, API ${API_VERSION}.`);

  const router = new EventRouter();
  const bridge = PhotinoBridge.attach(router);
  const storage = new IdbStore();
  await sink.attachStorage(storage);
  const registry = new Registry(storage);
  await registry.load();

  // VRCNext reports the platform once, right after the page sends `ready`. Until then assume
  // Windows so a desktop notification is attempted rather than silently dropped.
  let isLinux = false;
  router.on('setPlatform', (payload) => {
    if (typeof payload === 'object' && payload !== null) {
      isLinux = (payload as { isLinux?: unknown }).isLinux === true;
      logger.debug(`Platform reported: ${isLinux ? 'Linux' : 'Windows'}.`);
    }
  });

  const toast = createToast(sink);
  const ui = new UiHost(toast);

  const routes = new RouteTable(globalThis.location.href);
  routes.install();
  const contextMenu = new ContextMenuHub();
  contextMenu.install();

  const loader = new PluginLoader({
    router,
    bridge,
    storage,
    sink,
    ui,
    routes,
    deepLinks: new DeepLinkHub(router),
    contextMenu,
    isLinux: () => isLinux,
  });

  return {
    sink,
    logger,
    router,
    bridge,
    storage,
    manager: new PluginManager(registry, loader),
    ui,
    toast,
    routes,
    contextMenu,
  };
}

/** Mounts the Plugins tab: repository manager above, live log viewer below. */
function mountUi(core: Core, bag: DisposableBag): void {
  const panel = new ManagerPanel({
    manager: core.manager,
    onError: (message) => {
      core.logger.error(message);
      core.toast({ message, ok: false });
    },
  });

  const logPanel = new LogPanel(core.sink);
  bag.add(() => { logPanel.dispose(); });

  const hostUi = core.ui.forHost(bag);
  hostUi.addNavTab({
    label: 'Plugins',
    icon: 'extension',
    render: (container) => {
      panel.render(container);
      const logs = hostUi.createCard('Plugin logs', 'article');
      logPanel.render(logs);
      container.appendChild(logs);
    },
  });
}

export async function boot(): Promise<HostHandle> {
  const running = existingHost();
  if (running !== undefined) return running;

  const core = await buildCore();
  const bag = new DisposableBag();
  mountUi(core, bag);

  const failures = await core.manager.activateEnabled();
  for (const failure of failures) core.logger.error(failure.message);
  if (failures.length > 0) {
    core.toast({ message: `${String(failures.length)} plugin(s) failed to start.`, ok: false });
  }

  const shutdownController = new AbortController();
  const updater = new Updater({
    manager: core.manager,
    logger: core.logger.scoped('update'),
    notify: (message, ok) => { core.toast({ message, ok }); },
  });
  updater.start(shutdownController.signal);

  const handle: HostHandle = {
    apiVersion: API_VERSION,
    manager: core.manager,
    updater,
    shutdown: async (): Promise<void> => {
      shutdownController.abort();
      await core.manager.shutdown();
      core.contextMenu.uninstall();
      core.routes.uninstall();
      bag.dispose();
      core.sink.dispose();
      core.storage.close();
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = undefined;
    },
  };

  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = handle;

  // VRCNext fires this when the user disables the bootstrap theme.
  document.documentElement.addEventListener(
    `vrcnext:theme:unload:${THEME_ID}`,
    () => { void handle.shutdown(); },
    { once: true },
  );

  core.logger.info('Plugin host ready.');
  return handle;
}

export type { PluginManager } from './plugin-manager.js';
export { API_VERSION } from './api-version.js';
