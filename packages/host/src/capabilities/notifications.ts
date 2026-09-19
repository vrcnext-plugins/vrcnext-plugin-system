/**
 * {@link NotificationsApi} over VRCNext's four notification surfaces.
 *
 * Every global called here was read out of the VRCNext frontend. Where a global is missing —
 * an older VRCNext, or a future rename — the call degrades to the plugin log rather than
 * throwing into the caller's event handler.
 */

import type {
  Bridge,
  ConfirmOptions,
  DesktopNotifyOptions,
  Logger,
  NotificationsApi,
  NotifToastOptions,
  ToastOptions,
} from '@vrcnext/plugin-api';

/** `showToast(ok, msg)` — note VRCNext's argument order is (ok, msg), not (msg, ok). */
type ShowToast = (ok: boolean, msg: string) => void;
type ShowNotifToast = (type: string, sender: string, message: string) => void;
type ConfirmDelete = (opts: {
  id?: string;
  title: string;
  message: string;
  icon?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
}) => void;

/** VRCNext's frontend exposes these as plain globals; absence means an unexpected version. */
function lookup(name: string): ((...args: never[]) => unknown) | undefined {
  const candidate: unknown = (globalThis as Record<string, unknown>)[name];
  return typeof candidate === 'function'
    ? (candidate as (...args: never[]) => unknown)
    : undefined;
}

export class HostNotificationsApi implements NotificationsApi {
  readonly #bridge: Bridge;
  readonly #logger: Logger;
  readonly #isLinux: boolean;

  constructor(bridge: Bridge, logger: Logger, isLinux: boolean) {
    this.#bridge = bridge;
    this.#logger = logger;
    this.#isLinux = isLinux;
  }

  get desktopAvailable(): boolean {
    return !this.#isLinux;
  }

  toast({ message, ok = true }: ToastOptions): void {
    const show = lookup('showToast') as ShowToast | undefined;
    if (show === undefined) {
      this.#logger.info(`[toast] ${message}`);
      return;
    }
    show(ok, message);
  }

  notifToast({ kind, sender, message = '' }: NotifToastOptions): void {
    const show = lookup('showNotifToast') as ShowNotifToast | undefined;
    if (show === undefined) {
      this.#logger.info(`[${kind}] ${sender}: ${message}`);
      return;
    }
    show(kind, sender, message);
  }

  desktop(options: DesktopNotifyOptions): void {
    if (this.#isLinux) {
      // VRCNext compiles the tray and overlay out on Linux; surface it instead of silently dropping.
      this.#logger.debug(`Desktop notification skipped on Linux: ${options.title}`);
      return;
    }
    this.#bridge.send('afTrayNotify', {
      title: options.title,
      subtitle: options.subtitle ?? '',
      accent: options.accent ?? 'info',
      imageUrl: options.imageUrl ?? '',
      friendId: options.friendId ?? '',
    });
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    const show = lookup('vrcnConfirmDelete') as ConfirmDelete | undefined;
    if (show === undefined) {
      this.#logger.warn('Confirmation modal unavailable; treating as declined.');
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const id = `vrcnextPluginConfirm${String(Date.now())}`;
      let settled = false;
      const settle = (result: boolean): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(result);
      };

      // VRCNext's modal only calls back on confirm; cancelling or clicking the backdrop just
      // removes the element. Watch for removal so the promise always settles.
      const observer = new MutationObserver(() => {
        if (document.getElementById(id) === null) settle(false);
      });

      show({
        id,
        title: options.title,
        message: options.message,
        icon: options.icon ?? 'help',
        confirmLabel: options.confirmLabel ?? 'Confirm',
        onConfirm: () => { settle(true); },
      });

      if (document.getElementById(id) === null) {
        settle(false);
        return;
      }
      observer.observe(document.body, { childList: true });
    });
  }
}
