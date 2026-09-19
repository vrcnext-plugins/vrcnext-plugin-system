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
import { NativeClient } from './capabilities/native.js';
import { RouteTable } from './capabilities/router.js';
import { EventRouter } from './events/event-router.js';
import { PluginLoader } from './loader/plugin-loader.js';
import { createLogger } from './log/create-logger.js';
import { DebugHub } from './log/debug-hub.js';
import { LogSink } from './log/log-sink.js';
import { LogStream } from './log/log-stream.js';
import { PluginManager } from './plugin-manager.js';
import { Registry } from './registry/registry.js';
import { IdbStore } from './storage/idb-store.js';
import { AboutPanel } from './ui/about-panel.js';
import { LogPanel } from './ui/log-panel.js';
import { ManagerPanel } from './ui/manager-panel.js';
import { PluginNav, type NavEntry } from './ui/plugin-nav.js';
import { UiHost } from './ui/ui-host.js';
import { Updater } from './update/updater.js';

const GLOBAL_KEY = '__vrcnextPluginHost';
const BOOT_KEY = '__vrcnextPluginHostBooting';
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
      // VRCNext's signature is showToast(ok, msg) — ok first.
      (show as (ok: boolean, msg: string) => void)(ok, message);
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
  readonly native: NativeClient;
  readonly logStream: LogStream;
  readonly debugHub: DebugHub;
  readonly isLinux: () => boolean;
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

  // VRCNext sends `setPlatform` once, in response to the page's `ready` — which happens well
  // before a custom theme's script runs, so listening alone always misses it. It also records the
  // answer on the document, and that is still there when we boot. Seed from the DOM, then keep the
  // listener for the case where this host somehow loads first.
  let isLinux =
    (globalThis as { _isLinuxUi?: unknown })._isLinuxUi === true ||
    document.documentElement.classList.contains('linux-ui');
  logger.debug(`Platform at boot: ${isLinux ? 'Linux' : 'Windows'}.`);

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

  // Probed rather than awaited: the companion is optional, and boot must not wait on a daemon
  // most users do not run.
  const native = new NativeClient(createLogger(sink, 'native'));
  // Touch `ready` so the probe starts now; plugins await the same promise rather than racing it.
  void native.ready;

  // Mirror everything logged here into the companion's log file, so plugin behaviour can be
  // followed with `tail -f` instead of by keeping the Logs panel open and copying text out.
  // Entirely optional: with no daemon running this quietly retries in the background forever.
  const logStream = new LogStream(native.endpoint);
  logStream.start(sink);
  const debugHub = new DebugHub(sink);

  const loader = new PluginLoader({
    router,
    bridge,
    storage,
    sink,
    ui,
    routes,
    deepLinks: new DeepLinkHub(router),
    contextMenu,
    native,
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
    native,
    logStream,
    debugHub,
    isLinux: () => isLinux,
  };
}

/**
 * Mounts the "Plugins" group in both the sidebar and the top menu bar.
 *
 * The three entries are declared once; {@link PluginNav} renders them into two different DOM
 * shapes and shares activation, lazy rendering and tab ownership between them.
 */
function mountNav(core: Core, updater: Updater, bag: DisposableBag): void {
  const managerPanel = new ManagerPanel({
    manager: core.manager,
    onError: (message) => {
      core.logger.error(message);
      core.toast({ message, ok: false });
    },
  });

  const logPanel = new LogPanel(core.sink);
  bag.add(() => { logPanel.dispose(); });

  const aboutPanel = new AboutPanel({
    manager: core.manager,
    updater,
    sink: core.sink,
    logger: core.logger,
    native: core.native,
    debugHub: core.debugHub,
    isLinux: core.isLinux,
    openUrl: (url) => { core.bridge.send('openUrl', { url }); },
  });

  const entries: readonly NavEntry[] = [
    {
      id: 'manage',
      label: 'Manage Plugins',
      icon: 'extension',
      render: (container) => { managerPanel.render(container); },
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: 'article',
      render: (container) => {
        const host = core.ui.forHost(bag);
        const layout = host.createPanelLayout();
        const card = host.createCard('Plugin logs', 'article');
        logPanel.render(card);
        layout.appendChild(card);
        container.replaceChildren(layout);
      },
    },
    {
      id: 'system',
      label: 'Plugin System',
      icon: 'tune',
      render: (container) => { aboutPanel.render(container); },
    },
  ];

  const nav = new PluginNav({
    entries,
    groupId: 'vrcnextPluginsNavGroup',
    groupLabel: 'Plugins',
    groupIcon: 'extension',
    onError: (error, entry) => {
      core.logger.error(
        `Could not render "${entry.label}": ${error instanceof Error ? error.message : String(error)}`,
      );
    },
    onUiEvent: (action, detail) => {
      core.debugHub.logUi(action, detail);
    },
  });
  nav.mount();
  bag.add(nav);
}

export async function boot(): Promise<HostHandle> {
  const running = existingHost();
  if (running !== undefined) return running;

  const inFlight: unknown = (globalThis as Record<string, unknown>)[BOOT_KEY];
  if (inFlight instanceof Promise) return inFlight as Promise<HostHandle>;

  const bootPromise = (async (): Promise<HostHandle> => {
    try {
      const core = await buildCore();
      const bag = new DisposableBag();

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
      mountNav(core, updater, bag);

      const handle: HostHandle = {
        apiVersion: API_VERSION,
        manager: core.manager,
        updater,
        shutdown: async (): Promise<void> => {
          shutdownController.abort();
          core.debugHub.dispose();
          core.logStream.stop();
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
    } finally {
      (globalThis as Record<string, unknown>)[BOOT_KEY] = undefined;
    }
  })();

  (globalThis as Record<string, unknown>)[BOOT_KEY] = bootPromise;
  return bootPromise;
}

export type { PluginManager } from './plugin-manager.js';
export { API_VERSION } from './api-version.js';
