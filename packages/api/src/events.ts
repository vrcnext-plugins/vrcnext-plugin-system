/**
 * Typed view of the VRCNext host → page event stream.
 *
 * VRCNext emits roughly 310 distinct event types. Only the ones whose payload shape was read
 * directly out of the VRCNext C# source are typed here; everything else arrives as `unknown`
 * and must be narrowed by the plugin. That keeps the map honest — a guessed payload shape is
 * worse than no type at all, because it type-checks and then fails at runtime.
 *
 * Plugins needing an untyped event can declare its shape locally and narrow with a type guard,
 * or use module augmentation to extend `VrcnextEventMap` for their own build.
 */

/** Colour tag VRCNext applies to activity-log lines. */
export const LOG_COLORS = ['sec', 'warn', 'err'] as const;
export type LogColor = (typeof LOG_COLORS)[number];

/** Payloads verified against the VRCNext source at version 2026.60.5. */
export interface VrcnextEventMap {
  /** Sent once after the page reports `ready`; drives the hiding of Windows-only tabs. */
  readonly setPlatform: { readonly isLinux: boolean };

  /** Every activity-log line. Also mirrored to the on-disk log by the host. */
  readonly log: { readonly msg: string; readonly color?: LogColor };

  /** Transient UI notification. */
  readonly toast: { readonly ok: boolean; readonly msg: string };

  /** Progress of a startup database migration, 0–100. */
  readonly dbMigrationProgress: { readonly percent: number };

  /** A `vrcn://` deep link resolved by the host. */
  readonly openDeepLink: {
    readonly prefix: 'usr' | 'avtr' | 'wrld' | 'grp' | 'inst' | 'instjoin';
    readonly id: string;
    readonly action: string;
  };

  /** Friend state transition (online, offline, world change, status change, …). */
  readonly friendTimelineEvent: {
    readonly type: string;
    readonly friendId: string;
    readonly friendName: string;
    readonly friendImage: string;
    readonly worldName: string;
    readonly location: string;
    readonly oldValue: string;
    readonly newValue: string;
  };

  /** Theme list, emitted in response to the `getCustomThemes` action. */
  readonly customThemes: {
    readonly port: number;
    readonly themes: readonly {
      readonly id: string;
      readonly name: string;
      readonly cssFiles: readonly string[];
      readonly jsFiles: readonly string[];
      readonly author: string | null;
      readonly version: string | null;
      readonly builtIn: boolean;
    }[];
  };
}

export type KnownEventType = keyof VrcnextEventMap;

/** Payload for `type`, or `unknown` when the event is not in the verified map. */
export type EventPayload<T extends string> = T extends KnownEventType
  ? VrcnextEventMap[T]
  : unknown;

export type EventListener<T extends string> = (payload: EventPayload<T>) => void;

/** The `{ type, payload }` envelope Photino delivers as a JSON string. */
export interface HostEnvelope {
  readonly type: string;
  readonly payload: unknown;
}

export interface EventBus {
  /**
   * Subscribes to one host event type. Returns an unsubscribe function, which is also
   * registered on the plugin's disposable bag so forgetting to call it is not a leak.
   */
  on<T extends string>(type: T, listener: EventListener<T>): () => void;

  /** Subscribes for exactly one delivery. */
  once<T extends string>(type: T, listener: EventListener<T>): () => void;

  /** Subscribes to every host event. Intended for diagnostics, not for normal plugin logic. */
  onAny(listener: (envelope: HostEnvelope) => void): () => void;

  /** Resolves on the next delivery of `type`, or rejects when `signal` aborts. */
  next<T extends string>(type: T, signal?: AbortSignal): Promise<EventPayload<T>>;
}
