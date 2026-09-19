/**
 * The page ⇄ VRCNext-backend channel.
 *
 * Photino installs `window.external.sendMessage` / `receiveMessage` at document start. On Linux
 * the inbound side is an array of callbacks that `receiveMessage` pushes onto, so the host can
 * observe the stream without displacing VRCNext's own handler.
 *
 * Sending an action makes VRCNext act on the user's real VRChat account. Treat every call here
 * as outward-facing.
 */

import type { EventPayload } from './events.js';

/** A JS → C# action name, e.g. `vrcLaunchAndJoin`. */
export type ActionName = string;

/** Action arguments. VRCNext merges these into the envelope alongside `action`. */
export type ActionArgs = Readonly<Record<string, unknown>>;

export interface RequestOptions {
  /** Host event type that answers this action. */
  readonly expect: string;
  /** Milliseconds before the request rejects. Defaults to 10_000. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface Bridge {
  /** Fire-and-forget action dispatch. */
  send(action: ActionName, args?: ActionArgs): void;

  /**
   * Dispatches an action and resolves with the first matching response event.
   *
   * VRCNext has no request ids, so correlation is by event type only — a concurrent request for
   * the same response type may resolve with the other caller's payload. Use it for read-style
   * actions, not for anything where a mix-up matters.
   */
  request<T extends string>(
    action: ActionName,
    args: ActionArgs,
    options: RequestOptions & { readonly expect: T },
  ): Promise<EventPayload<T>>;

  /**
   * Observes every outbound action, including VRCNext's own. Returning `false` from the
   * interceptor drops the message before it reaches the backend.
   */
  interceptOutbound(interceptor: (action: ActionName, raw: string) => boolean | undefined): () => void;
}
