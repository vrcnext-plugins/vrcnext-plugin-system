/**
 * {@link DeepLinkApi} over VRCNext's `openDeepLink` event.
 *
 * VRCNext validates the link in C# and only forwards the six known prefixes, so this observes
 * rather than registers. A plugin wanting its own namespace uses the in-page router instead.
 */

import {
  DEEP_LINK_PREFIXES,
  type DeepLinkApi,
  type DeepLinkEvent,
  type DeepLinkPrefix,
  type DisposableBag,
} from '@vrcnext/plugin-api';

import type { EventRouter } from '../events/event-router.js';

const PREFIXES = new Set<string>(DEEP_LINK_PREFIXES);

function isPrefix(value: unknown): value is DeepLinkPrefix {
  return typeof value === 'string' && PREFIXES.has(value);
}

function toEvent(payload: unknown): DeepLinkEvent | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const prefix = record['prefix'];
  const id = record['id'];
  if (!isPrefix(prefix) || typeof id !== 'string') return undefined;
  return { prefix, id, action: typeof record['action'] === 'string' ? record['action'] : '' };
}

type Listener = (event: DeepLinkEvent) => boolean | undefined;

/** Shared across plugins so "handled" can stop later listeners in registration order. */
export class DeepLinkHub {
  readonly #listeners: Listener[] = [];

  constructor(router: EventRouter) {
    router.on('openDeepLink', (payload) => {
      const event = toEvent(payload);
      if (event === undefined) return;
      for (const listener of [...this.#listeners]) {
        try {
          if (listener(event) === true) return;
        } catch (error) {
          globalThis.console.error('[vrcnext-plugins] deep-link listener threw', error);
        }
      }
    });
  }

  add(listener: Listener): () => void {
    this.#listeners.push(listener);
    return (): void => {
      const index = this.#listeners.indexOf(listener);
      if (index >= 0) this.#listeners.splice(index, 1);
    };
  }
}

export class PluginDeepLinkApi implements DeepLinkApi {
  readonly #hub: DeepLinkHub;
  readonly #bag: DisposableBag;

  constructor(hub: DeepLinkHub, bag: DisposableBag) {
    this.#hub = hub;
    this.#bag = bag;
  }

  on(listener: Listener): () => void {
    const dispose = this.#hub.add(listener);
    this.#bag.add(dispose);
    return dispose;
  }

  onPrefix(prefix: DeepLinkPrefix, listener: Listener): () => void {
    return this.on((event) => (event.prefix === prefix ? listener(event) : undefined));
  }
}
