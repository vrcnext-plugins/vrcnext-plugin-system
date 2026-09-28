/**
 * Answers the bridge's `remote` pushes: run a snippet in this page, send the result back.
 *
 * The bridge only offers its `remote` service when started with `--dev`, and only a caller
 * holding the pairing token can reach `remote/eval`. That caller — a script, an agent, `curl` —
 * gets to inspect and operate the page without a synthetic mouse, which is the whole point:
 * nobody has to give up their pointer so that a tab can be opened and read.
 *
 * The snippet is the body of an `async` function. Whatever it returns is serialised as JSON and
 * handed back; a thrown error comes back as `ok: false` with its message. The function sees a
 * small scope — `host`, and the helpers in {@link REMOTE_HELPERS} — on top of the page's globals.
 */

import type { Logger } from '@vrcnext/plugin-api';

import type { BridgeClient } from './native.js';

/** The push event the bridge uses. Mirrors `vrcnext_bridge_core::remote::PUSH_EVENT`. */
export const REMOTE_EVENT = 'remote';

/** Longest serialised value sent back. The socket frame limit is 1 MiB; this leaves room. */
export const MAX_RESULT_CHARS = 512 * 1024;

export interface RemoteRequest {
  /** The bridge's 128-bit random id, as 22 base64url characters. */
  readonly id: string;
  readonly code: string;
}

export type RemoteOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

const EVAL_ID = /^[A-Za-z0-9_-]{22}$/;

/** Narrows a `remote` push payload. */
export function toRemoteRequest(data: unknown): RemoteRequest | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { id, code } = data as { id?: unknown; code?: unknown };
  if (typeof id !== 'string' || !EVAL_ID.test(id) || typeof code !== 'string') return undefined;
  return { id, code };
}

function visible(element: Element | null): boolean {
  return element instanceof HTMLElement && element.offsetParent !== null;
}

/**
 * Convenience functions a snippet may call by name. Kept deliberately small: anything else is a
 * `document.querySelector` away, and the snippet has the whole page.
 */
export const REMOTE_HELPERS = {
  /** Trimmed `innerText` of the first match, or `undefined`. */
  text: (selector: string): string | undefined => {
    const element = document.querySelector(selector);
    return element instanceof HTMLElement ? element.innerText.trim() : undefined;
  },
  /** Clicks the first match. Returns whether something was there to click. */
  click: (selector: string): boolean => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  },
  /** Whether the first match is rendered (has a layout box). */
  visible: (selector: string): boolean => visible(document.querySelector(selector)),
  /** Bounding boxes of every visible match, for checking a layout without a screenshot. */
  rects: (selector: string): { x: number; y: number; w: number; h: number }[] =>
    [...document.querySelectorAll(selector)].filter(visible).map((element) => {
      const r = element.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  /** Resolves after `ms`, for letting the page settle between actions. */
  sleep: (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); }),
} as const;

/** JSON that fits the frame. Anything unserialisable falls back to its string form. */
export function serialise(value: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(value === undefined ? null : value);
  } catch {
    text = undefined;
  }
  if (text === undefined) return String(value);
  if (text.length <= MAX_RESULT_CHARS) return JSON.parse(text) as unknown;
  return { truncated: true, chars: text.length, head: text.slice(0, MAX_RESULT_CHARS) };
}

/**
 * Runs `code` as the body of an async function whose parameters are the keys of `scope`.
 *
 * The `Function` constructor is exactly the tool for "run text the operator sent"; the source
 * policy that forbids it applies to plugins, not to the host answering its own bridge.
 */
export async function runSnippet(code: string, scope: Readonly<Record<string, unknown>>): Promise<RemoteOutcome> {
  try {
    const AsyncFunction = (Object.getPrototypeOf(runSnippet) as { constructor: unknown }).constructor as new (
      ...args: string[]
    ) => (...values: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction(...Object.keys(scope), code);
    const value = await fn(...Object.values(scope));
    return { ok: true, value: serialise(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

export interface RemoteControlDeps {
  readonly native: BridgeClient;
  readonly logger: Logger;
  /** What a snippet sees by name, on top of the helpers. */
  readonly scope: Readonly<Record<string, unknown>>;
}

/** Starts answering `remote` pushes. Returns the unsubscribe. */
export function attachRemoteControl(deps: RemoteControlDeps): () => void {
  const scope = { ...REMOTE_HELPERS, ...deps.scope };
  return deps.native.onPush((event, data) => {
    if (event !== REMOTE_EVENT) return;
    const request = toRemoteRequest(data);
    if (request === undefined) {
      deps.logger.warn('Ignored a malformed remote request from the bridge.');
      return;
    }
    void (async (): Promise<void> => {
      const outcome = await runSnippet(request.code, scope);
      const reply = outcome.ok
        ? { id: request.id, ok: true, value: outcome.value }
        : { id: request.id, ok: false, error: outcome.error };
      try {
        await deps.native.call('remote', 'result', reply);
      } catch (error) {
        deps.logger.warn(`Could not return remote result ${request.id} to the bridge.`, error);
      }
    })();
  });
}
