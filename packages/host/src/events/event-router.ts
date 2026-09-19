/**
 * Fan-out for the VRCNext host event stream.
 *
 * One router is shared by the whole host; each plugin gets a thin `EventBus` view that records
 * its subscriptions so they can all be dropped on deactivate.
 *
 * A listener that throws must not stop delivery to the other listeners — a plugin crashing its
 * own handler should not deafen the rest of the app.
 */

import type { EventPayload, HostEnvelope } from '@vrcnext/plugin-api';

type AnyListener = (payload: unknown) => void;
type EnvelopeListener = (envelope: HostEnvelope) => void;

export class EventRouter {
  readonly #byType = new Map<string, Set<AnyListener>>();
  readonly #anyListeners = new Set<EnvelopeListener>();

  /** Parses and fans out one raw Photino message. */
  dispatchRaw(raw: string): void {
    let envelope: HostEnvelope;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const type = (parsed as { type?: unknown }).type;
      if (typeof type !== 'string') return;
      envelope = { type, payload: (parsed as { payload?: unknown }).payload };
    } catch {
      // Not our traffic; another injected script may share the channel.
      return;
    }
    this.dispatch(envelope);
  }

  dispatch(envelope: HostEnvelope): void {
    const typed = this.#byType.get(envelope.type);
    if (typed !== undefined) {
      // Copy first: a listener may unsubscribe itself during delivery.
      for (const listener of [...typed]) {
        EventRouter.#deliver(() => { listener(envelope.payload); }, envelope.type);
      }
    }
    for (const listener of [...this.#anyListeners]) {
      EventRouter.#deliver(() => { listener(envelope); }, envelope.type);
    }
  }

  static #deliver(call: () => void, type: string): void {
    try {
      call();
    } catch (error) {
      globalThis.console.error(`[vrcnext-plugins] listener for "${type}" threw`, error);
    }
  }

  on(type: string, listener: AnyListener): () => void {
    let set = this.#byType.get(type);
    if (set === undefined) {
      set = new Set();
      this.#byType.set(type, set);
    }
    set.add(listener);
    return (): void => {
      const current = this.#byType.get(type);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.#byType.delete(type);
    };
  }

  onAny(listener: EnvelopeListener): () => void {
    this.#anyListeners.add(listener);
    return (): void => { this.#anyListeners.delete(listener); };
  }

  /** Resolves on the next delivery of `type`, rejecting if `signal` aborts first. */
  next<T extends string>(type: T, signal?: AbortSignal): Promise<EventPayload<T>> {
    return new Promise<EventPayload<T>>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(EventRouter.#abortError(signal));
        return;
      }

      const unsubscribe = this.on(type, (payload) => {
        cleanup();
        resolve(payload as EventPayload<T>);
      });

      const onAbort = (): void => {
        cleanup();
        reject(EventRouter.#abortError(signal));
      };

      function cleanup(): void {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      }

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  static #abortError(signal: AbortSignal | undefined): Error {
    const reason: unknown = signal?.reason;
    return reason instanceof Error ? reason : new Error('Aborted.');
  }
}
