/**
 * Requests to VRCNext whose replies its own page does not get to see.
 *
 * Photino delivers every backend message to each callback in `window.__receiveMessageCallbacks`
 * in registration order. VRCNext's dispatcher is the first one; it paints a modal, or opens
 * one, for replies such as `vrcFriendDetail`, `vrcAvatarDetail` or `vrcInstanceAvatarFound`.
 * This wraps every callback registered before the host's own so a reply the host asked for is
 * handed to the host and withheld from VRCNext. Replies nobody asked for pass through untouched.
 *
 * VRCNext has no request ids, so a request names the reply type and an `accept` function that
 * recognises its own answer in the payload (by id, query, …). Detail lookups often answer twice
 * — a cached copy, then a fresh one — so a rule keeps swallowing matching replies for a short
 * while after it resolved.
 */

import type { ActionArgs } from '@vrcnext/plugin-api';

import type { EventRouter } from '../../events/event-router.js';

export interface QuietRequest<T> {
  readonly action: string;
  readonly args?: ActionArgs;
  /** The reply's event type. */
  readonly expect: string;
  /** The narrowed answer when `payload` is this request's reply, `undefined` otherwise. */
  accept(payload: unknown): T | undefined;
  /**
   * Keep VRCNext from handling the reply. Default `true`. `false` for replies VRCNext handles
   * harmlessly and usefully, such as refreshing a list it shows anyway.
   */
  readonly swallow?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface Rule {
  readonly expect: string;
  readonly accept: (payload: unknown) => unknown;
  readonly swallow: boolean;
  resolved: boolean;
  /** After resolving, matching replies are still swallowed until this time. */
  until: number;
  resolve(value: unknown): void;
}

type Callback = (raw: string) => void;

export const DEFAULT_TIMEOUT_MS = 15_000;
/** How long after the answer a rule keeps swallowing the follow-up reply. */
const FOLLOW_UP_MS = 20_000;

interface Envelope {
  readonly type: string;
  readonly payload: unknown;
}

function parse(raw: string): Envelope | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' ? { type, payload: (parsed as { payload?: unknown }).payload } : undefined;
  } catch {
    return undefined;
  }
}

export interface QuietChannelDeps {
  readonly send: (action: string, args: ActionArgs) => void;
  /** Fallback delivery when there is no callback array to wrap (tests, other shells). */
  readonly router: EventRouter;
  /** Photino's callback list, `undefined` where the page has none. */
  readonly callbacks: () => Callback[] | undefined;
  readonly now?: () => number;
}

export class QuietChannel {
  readonly #deps: QuietChannelDeps;
  readonly #rules = new Set<Rule>();
  readonly #wrapped = new Map<Callback, Callback>();
  #fallback: (() => void) | undefined;

  constructor(deps: QuietChannelDeps) {
    this.#deps = deps;
  }

  /** Wraps the callbacks registered so far — VRCNext's — and leaves later ones alone. */
  install(): void {
    const callbacks = this.#deps.callbacks();
    if (callbacks === undefined) {
      this.#fallback = this.#deps.router.onAny((envelope) => { this.#inspect(envelope); });
      return;
    }
    for (let i = 0; i < callbacks.length; i += 1) {
      const original = callbacks[i];
      if (original === undefined || this.#wrapped.has(original)) continue;
      const wrapper: Callback = (raw) => {
        if (this.#swallows(raw)) return;
        original(raw);
      };
      this.#wrapped.set(wrapper, original);
      callbacks[i] = wrapper;
    }
  }

  uninstall(): void {
    this.#fallback?.();
    this.#fallback = undefined;
    const callbacks = this.#deps.callbacks() ?? [];
    for (let i = 0; i < callbacks.length; i += 1) {
      const current = callbacks[i];
      const original = current === undefined ? undefined : this.#wrapped.get(current);
      if (original !== undefined) callbacks[i] = original;
    }
    this.#wrapped.clear();
  }

  get pending(): number {
    return [...this.#rules].filter((rule) => !rule.resolved).length;
  }

  #swallows(raw: string): boolean {
    if (this.#rules.size === 0) return false;
    const envelope = parse(raw);
    return envelope === undefined ? false : this.#inspect(envelope);
  }

  /** Feeds one reply to the rules. `true` when a rule claims it and wants it withheld. */
  #inspect(envelope: Envelope): boolean {
    const now = (this.#deps.now ?? Date.now)();
    let withhold = false;
    for (const rule of [...this.#rules]) {
      if (rule.resolved && now > rule.until) {
        this.#rules.delete(rule);
        continue;
      }
      if (rule.expect !== envelope.type) continue;
      let value: unknown;
      try {
        value = rule.accept(envelope.payload);
      } catch {
        continue;
      }
      if (value === undefined) continue;
      if (!rule.resolved) {
        rule.resolved = true;
        rule.until = now + FOLLOW_UP_MS;
        rule.resolve(value);
      }
      withhold ||= rule.swallow;
    }
    return withhold;
  }

  /** Sends `action` and resolves with the first reply `accept` recognises. */
  request<T>(request: QuietRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const rule: Rule = {
        expect: request.expect,
        accept: (payload) => request.accept(payload),
        swallow: request.swallow ?? true,
        resolved: false,
        until: Number.POSITIVE_INFINITY,
        resolve: (value) => {
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
      };
      const fail = (error: Error): void => {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        this.#rules.delete(rule);
        reject(error);
      };
      const onAbort = (): void => { fail(new Error('Request aborted.')); };
      const timer = setTimeout(() => {
        fail(new Error(`VRCNext did not answer "${request.action}" with "${request.expect}" within ${String(timeoutMs)} ms.`));
      }, timeoutMs);
      if (request.signal?.aborted === true) {
        onAbort();
        return;
      }
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.#rules.add(rule);
      this.#deps.send(request.action, request.args ?? {});
    });
  }
}

/** Photino's list on this page, if the bootstrap defined it. */
export function photinoCallbacks(): Callback[] | undefined {
  const list: unknown = (globalThis as { __receiveMessageCallbacks?: unknown }).__receiveMessageCallbacks;
  return Array.isArray(list) ? (list as Callback[]) : undefined;
}
