/**
 * Host entry point.
 *
 * Loaded by the bootstrap theme VRCNext injects into its page. Boot is idempotent: VRCNext can
 * re-inject a theme script without a reload, and booting twice would double every listener.
 */

import { DisposableBag, type ToastOptions } from '@vrcnext/plugin-api';

import { API_VERSION } from './api-version.js';
import { PhotinoBridge } from './bridge/photino-bridge.js';
import { ContextMenuHub } from './capabilities/context-menu.js';
import { DeepLinkHub } from './capabilities/deep-links.js';
import { RouteTable } from './capabilities/router.js';
import { EventRouter } from './events/event-router.js';
import { PluginLoader } from './loader/plugin-loader.js';
import { createLogger, LogSink } from './log/host-logger.js';
import { PluginManager } from './plugin-manager.js';
import { Registry } from './registry/registry.js';
import { IdbStore } from './storage/idb-store.js';
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

export async function boot(): Promise<HostHandle> {
  const running = existingHost();
  if (running !== undefined) return running;

  const sink = new LogSink();
  const logger = createLogger(sink, 'host');
  logger.info(`Starting plugin host, API ${API_VERSION}.`);

  const router = new EventRouter();
  const bridge = PhotinoBridge.attach(router);
  const storage = new IdbStore();
  const registry = new Registry(storage);
  await registry.load();

  const toast = createToast(sink);
  const ui = new UiHost(toast);

  const routes = new RouteTable(globalThis.location.href);
  routes.install();
  const deepLinks = new DeepLinkHub(router);
  const contextMenu = new ContextMenuHub();
  contextMenu.install();

  const loader = new PluginLoader({
    router,
    bridge,
    storage,
    sink,
    ui,
    routes,
    deepLinks,
    contextMenu,
  });
  const manager = new PluginManager(registry, loader);

  const panel = new ManagerPanel({
    manager,
    onError: (message) => {
      logger.error(message);
      toast({ message, ok: false });
    },
  });

  const bag = new DisposableBag();
  const hostUi = ui.forHost(bag);

  hostUi.addNavTab({
    label: 'Plugins',
    icon: 'extension',
    render: (container) => { panel.render(container); },
  });

  const failures = await manager.activateEnabled();
  for (const failure of failures) logger.error(failure.message);
  if (failures.length > 0) {
    toast({ message: `${String(failures.length)} plugin(s) failed to start.`, ok: false });
  }

  const shutdownController = new AbortController();
  const updater = new Updater({
    manager,
    logger: logger.scoped('update'),
    notify: (message, ok) => { toast({ message, ok }); },
  });
  updater.start(shutdownController.signal);

  const handle: HostHandle = {
    apiVersion: API_VERSION,
    manager,
    updater,
    shutdown: async (): Promise<void> => {
      shutdownController.abort();
      await manager.shutdown();
      contextMenu.uninstall();
      routes.uninstall();
      bag.dispose();
      storage.close();
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

  logger.info('Plugin host ready.');
  return handle;
}

export type { PluginManager } from './plugin-manager.js';
export { API_VERSION } from './api-version.js';
