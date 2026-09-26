/**
 * The native companion: `vrcnext-bridge`.
 *
 * VRCNext's page can only speak HTTP and WebSockets. Anything needing a UDP socket, a D-Bus
 * connection or a unix socket has to happen in a native process, so the bridge supplies those.
 * When a plugin runs, the bridge is connected by construction — the host does not activate
 * plugins until its socket is up — so there is nothing here about probing or availability.
 *
 * The daemon is a *service host*, not a notification daemon. `notify` is the service that ships
 * today; {@link NativeApi.call} is the generic escape hatch so a plugin can use a service added
 * after this API was written, without waiting for a plugin-system release.
 *
 * Every method needs the `native` permission.
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

export interface NativeApi {
  /** The notification targets the bridge has configured. */
  targets(): Promise<readonly NativeTarget[]>;

  /**
   * Send a notification.
   *
   * Resolves with `ok: false` and the failures listed when no target accepted, rather than
   * rejecting: a VR overlay that is not running is a normal state, not an exception.
   */
  notify(options: NativeNotifyOptions): Promise<NativeNotifyResult>;

  /**
   * Call any service method on the bridge, over the shared socket.
   *
   * The forward-compatible path: a bridge that grows a new service is usable from a plugin
   * immediately, without a matching plugin-system release.
   *
   * @throws If the socket closes before the answer, the call times out, or the bridge answers
   *   with an error — the latter as a `NativeRequestError` carrying its `code`.
   */
  call(service: string, method: string, params?: unknown): Promise<unknown>;
}
