/**
 * VRChat game log stream.
 *
 * VRCNext tails VRChat's `output_log_*.txt` and republishes parsed entries as `gameLogEvent`.
 * Most of VRCNext's timeline comes from here rather than from the VRChat API, so this is the
 * lowest-latency source for "who joined", "world changed" and similar.
 *
 * Payload shape verified against `AuthController.cs`, which emits
 * `{ type, timestamp, message, detail }`.
 */

/**
 * Entry kinds VRCNext 2026.61.2 emits (`VRChatLogWatcher.EmitGameLog`). For autocomplete only:
 * `GameLogEntry.type` stays `string` because VRCNext adds kinds between releases.
 */
export const GAME_LOG_TYPES = [
  'gl_player_join',
  'gl_player_left',
  'gl_world_join',
  'gl_instance_closed',
  'gl_avatar_blocked',
  'gl_portal',
  'gl_video_url',
  'gl_screenshot',
  'gl_image_error',
  'gl_connection_lost',
] as const;
export type GameLogType = (typeof GAME_LOG_TYPES)[number];

export interface GameLogEntry {
  /** VRCNext's parsed entry kind, e.g. `gl_player_join`. See {@link GAME_LOG_TYPES}; not a closed set. */
  readonly type: string;
  /** ISO-ish timestamp string exactly as VRCNext emitted it. */
  readonly timestamp: string;
  readonly message: string;
  readonly detail: string;
}

export interface GameLogApi {
  /** Fires for each new entry as VRChat writes it. */
  on(listener: (entry: GameLogEntry) => void): () => void;

  /** Fires only for entries whose `type` matches. */
  onType(type: string, listener: (entry: GameLogEntry) => void): () => void;

  /**
   * Requests the backlog VRCNext keeps (up to 1000 entries) and resolves with it.
   * Uses the shared `getGameLog` action, so a concurrent caller may receive the same batch.
   */
  history(signal?: AbortSignal): Promise<readonly GameLogEntry[]>;
}
