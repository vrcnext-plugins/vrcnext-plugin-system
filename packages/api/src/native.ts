/**
 * The optional native companion: `vrcnext-bridge`.
 *
 * VRCNext's page can only speak HTTP. Anything needing a UDP socket, a D-Bus connection or a unix
 * socket has to happen in a native process, so a small loopback daemon supplies those. It is
 * **optional** — every method here degrades to a clean "unavailable" when the daemon is not
 * running, and no plugin should treat its absence as an error.
 *
 * The daemon is a *service host*, not a notification daemon. `notify` is the service that ships
 * today; {@link NativeApi.call} is the generic escape hatch so a plugin can use a service added
 * after this API was written, without waiting for a plugin-system release.
 *
 * @see https://github.com/vrcnext-plugins/vrcnext-bridge
 */

/** How urgently a native notification should be presented. */
export type NativeUrgency = 'low' | 'normal' | 'critical';

/**
 * Presentation fields shared by a request and its per-target overrides.
 *
 * Not every target honours every field — a VR overlay understands panel height, the desktop's
 * notification daemon does not. {@link NativeTarget.honours} reports what each one actually uses,
 * so a plugin can adapt instead of guessing.
 */
export interface NativeNotifyFields {
  /** Body text. */
  readonly content?: string;
  /** How long to display, in seconds. Omit or `0` for the target's own default. */
  readonly timeoutSecs?: number;
  /** A freedesktop icon name, or base64 image data when `useBase64Icon` is set. */
  readonly icon?: string;
  /** Whether `icon` carries base64 image data rather than a name. */
  readonly useBase64Icon?: boolean;
  /** Application name to attribute the notification to. Defaults to `VRCNext`. */
  readonly sourceApp?: string;
  /** Whether the target should play its notification sound. */
  readonly sound?: boolean;
  /** Sound volume, 0–1. */
  readonly volume?: number;
  /** A sound file for the target to play instead of its default. */
  readonly audioPath?: string;
  /** Panel height, in the target's own units. VR overlays only. */
  readonly height?: number;
  /** Panel opacity, 0–1. VR overlays only. */
  readonly opacity?: number;
  /** Urgency hint. Desktop notification daemons only. */
  readonly urgency?: NativeUrgency;
  /** Show even while the overlay dashboard is open. VR overlays only. */
  readonly alwaysShow?: boolean;
}

/** A per-target patch. Anything set here replaces the request's value for that target alone. */
export interface NativeNotifyOverride extends NativeNotifyFields {
  /** Replacement title. */
  readonly title?: string;
}

export interface NativeNotifyOptions extends NativeNotifyFields {
  /** Notification title. The only required field. */
  readonly title: string;
  /**
   * Which targets to deliver to, by name. Omit for every configured target.
   *
   * This is how a plugin says "VR only" — `sinks: ['wayvr']` reaches the overlay and leaves the
   * user's monitor alone.
   */
  readonly sinks?: readonly string[];
  /**
   * Per-target patches, keyed by target name.
   *
   * One call can therefore present itself differently in each place:
   *
   * ```ts
   * await ctx.native.notify({
   *   title: 'Friend online',
   *   content: 'Tupper is in Great Pug',
   *   overrides: {
   *     wayvr: { content: 'Tupper → Great Pug', height: 220, opacity: 0.85, alwaysShow: true },
   *   },
   * });
   * ```
   *
   * A patch naming a target that is not being delivered to is ignored, so carrying presentation
   * for an overlay the user does not run costs nothing.
   */
  readonly overrides?: Readonly<Record<string, NativeNotifyOverride>>;
}

/** One place a native notification can land. */
export interface NativeTarget {
  /** Stable name, used in `sinks` and `overrides`. */
  readonly name: string;
  /** Human-readable description of where this target sends things. */
  readonly description: string;
  /**
   * The target's own liveness guess.
   *
   * `'unknown'` is honest rather than evasive: a fire-and-forget UDP target cannot know whether
   * anything is listening on the other end.
   */
  readonly health: 'up' | 'unknown' | 'down';
  /** Which {@link NativeNotifyFields} keys this target actually honours. */
  readonly honours: readonly string[];
}

/** The outcome of one {@link NativeApi.notify} call. */
export interface NativeNotifyResult {
  /** Whether at least one target accepted. */
  readonly ok: boolean;
  /** Targets that accepted. */
  readonly delivered: readonly string[];
  /** Targets that did not, and why. */
  readonly failed: readonly { readonly sink: string; readonly error: string }[];
}

/** What a running companion offers. */
export interface NativeDescription {
  /** Companion version. */
  readonly version: string;
  /** Service names, and their self-description. */
  readonly services: Readonly<Record<string, unknown>>;
}

export interface NativeApi {
  /**
   * Whether the companion answered its health check at boot.
   *
   * Check this before offering a VR-notification toggle in a settings panel, so the user is not
   * shown a switch that silently does nothing.
   */
  readonly available: boolean;

  /** Where the host is looking for the companion. */
  readonly endpoint: string;

  /**
   * Re-probe the companion.
   *
   * Worth calling when a user has just been told to start it — the boot-time probe is a snapshot,
   * not a subscription.
   */
  probe(): Promise<boolean>;

  /** What the running companion offers, or `undefined` when it is not running. */
  describe(): Promise<NativeDescription | undefined>;

  /**
   * The notification targets this companion has.
   *
   * Empty when the companion is not running, so a plugin can render "no VR targets" without
   * branching on {@link NativeApi.available} first.
   */
  targets(): Promise<readonly NativeTarget[]>;

  /**
   * Send a notification.
   *
   * Resolves with `ok: false` and an empty `delivered` list when the companion is not running,
   * rather than rejecting. A missing companion is a normal state, not an exception.
   */
  notify(options: NativeNotifyOptions): Promise<NativeNotifyResult>;

  /**
   * Call any service method on the companion.
   *
   * The forward-compatible path: a companion that grows a new service is usable from a plugin
   * immediately, without a matching plugin-system release.
   *
   * @throws If the companion is unreachable or answers with an error.
   */
  call(service: string, method: string, params?: unknown): Promise<unknown>;
}
