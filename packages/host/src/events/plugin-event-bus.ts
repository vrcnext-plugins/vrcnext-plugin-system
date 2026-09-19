/**
 * Per-plugin view of the shared {@link EventRouter}.
 *
 * Every subscription is registered on the plugin's disposable bag, so a plugin that forgets to
 * unsubscribe still stops receiving events when it is disabled.
 */

import type {
  DisposableBag,
  EventBus,
  EventListener,
  EventPayload,
  HostEnvelope,
} from '@vrcnext/plugin-api';

import type { EventRouter } from './event-router.js';

export class PluginEventBus implements EventBus {
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;

  constructor(router: EventRouter, bag: DisposableBag) {
    this.#router = router;
    this.#bag = bag;
  }

  on<T extends string>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.#router.on(type, (payload) => {
      listener(payload as EventPayload<T>);
    });
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }

  once<T extends string>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  onAny(listener: (envelope: HostEnvelope) => void): () => void {
    const unsubscribe = this.#router.onAny(listener);
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }

  next<T extends string>(type: T, signal?: AbortSignal): Promise<EventPayload<T>> {
    return this.#router.next(type, signal);
  }
}
