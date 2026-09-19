/**
 * Notifications.
 *
 * VRCNext has four distinct notification surfaces, and they are not interchangeable:
 *
 * | Surface | Reaches | Availability |
 * | :-- | :-- | :-- |
 * | In-app toast | The VRCNext window | Everywhere |
 * | Notification toast | The VRCNext window, styled as an invite/friend-request | Everywhere |
 * | Desktop + VR notification | OS tray toast **and** the SteamVR wrist overlay | **Windows only** |
 * | Confirmation modal | The VRCNext window, blocking | Everywhere |
 *
 * The desktop/VR channel is one action in VRCNext (`afTrayNotify`) that fans out to the tray
 * toast, the overlay's notification list and the overlay's toast queue. It is wrapped in
 * `#if WINDOWS`, so on Linux it is a no-op — `desktopAvailable` reports this rather than
 * failing silently.
 *
 * The tray toast additionally requires the user to have **Minimize to tray** and **Tray
 * notifications** enabled in VRCNext; the overlay part requires SteamVR and the wrist overlay
 * to be running. Neither is something a plugin can detect, so treat delivery as best-effort.
 */

import type { IconName } from './ui.js';

/** Accent key VRCNext maps to a colour on the tray toast. */
export const NOTIFY_ACCENTS = ['accent', 'info', 'ok', 'warn', 'err'] as const;
export type NotifyAccent = (typeof NOTIFY_ACCENTS)[number];

export interface ToastOptions {
  readonly message: string;
  /** `false` renders the error style. Defaults to `true`. */
  readonly ok?: boolean;
}

/** VRCNext's own notification-toast style, as used for invites and friend requests. */
export const NOTIF_TOAST_KINDS = ['invite', 'friendRequest', 'notification'] as const;
export type NotifToastKind = (typeof NOTIF_TOAST_KINDS)[number];

export interface NotifToastOptions {
  readonly kind: NotifToastKind;
  /** Rendered as "<kind> from <sender>". */
  readonly sender: string;
  readonly message?: string;
}

export interface DesktopNotifyOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly accent?: NotifyAccent;
  /** Image shown on the toast and in the VR overlay entry. */
  readonly imageUrl?: string;
  /** Associates the entry with a VRChat user in the overlay. */
  readonly friendId?: string;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  /** Defaults to "Confirm". */
  readonly confirmLabel?: string;
  readonly icon?: IconName;
}

export interface NotificationsApi {
  /** Transient toast inside the VRCNext window. */
  toast(options: ToastOptions): void;

  /** Toast styled as one of VRCNext's own notification kinds. */
  notifToast(options: NotifToastOptions): void;

  /**
   * OS tray toast **and** SteamVR wrist-overlay notification, in one call.
   *
   * No-op on Linux — check {@link desktopAvailable} first if the distinction matters to your
   * plugin's behaviour.
   */
  desktop(options: DesktopNotifyOptions): void;

  /** `false` on Linux, where VRCNext compiles out the tray and overlay. */
  readonly desktopAvailable: boolean;

  /**
   * Blocking confirmation modal. Resolves `true` only if the user confirms; dismissing,
   * cancelling or clicking the backdrop all resolve `false`.
   */
  confirm(options: ConfirmOptions): Promise<boolean>;
}
