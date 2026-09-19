/**
 * Adapter over Photino's `window.external` channel.
 *
 * Inbound: Photino's Linux bootstrap defines `window.__receiveMessageCallbacks` as an array and
 * `receiveMessage` pushes onto it, so registering here observes the stream alongside VRCNext's
 * own handler rather than replacing it. The Windows/WebView2 bootstrap exposes the same
 * `receiveMessage` contract, so the adapter works on both without branching.
 *
 * Outbound: `sendMessage` is a writable property, so it can be wrapped to observe or drop
 * messages. The wrapper always delegates to the captured original, never to whatever is on
 * `window.external` at call time, so two wrappers cannot recurse into each other.
 */

import type {
  ActionArgs,
  ActionName,
  Bridge,
  EventPayload,
  RequestOptions,
} from '@vrcnext/plugin-api';

import type { EventRouter } from '../events/event-router.js';

const DEFAULT_TIMEOUT_MS = 10_000;

interface PhotinoExternal {
  sendMessage(message: string): void;
  receiveMessage(callback: (message: string) => void): void;
}

function readExternal(): PhotinoExternal {
  const external: unknown = (globalThis as { external?: unknown }).external;
  if (
    typeof external !== 'object' ||
    external === null ||
    typeof (external as PhotinoExternal).sendMessage !== 'function' ||
    typeof (external as PhotinoExternal).receiveMessage !== 'function'
  ) {
    throw new Error(
      'window.external is not a Photino bridge — the plugin host must run inside VRCNext.',
    );
  }
  return external as PhotinoExternal;
}

type OutboundInterceptor = (action: ActionName, raw: string) => boolean | undefined;

export class PhotinoBridge implements Bridge {
  readonly #router: EventRouter;
  readonly #interceptors = new Set<OutboundInterceptor>();
  /** Captured before wrapping, so two wrappers cannot recurse into each other. */
  readonly #originalSend: (message: string) => void;

  private constructor(external: PhotinoExternal, router: EventRouter) {
    this.#router = router;
    this.#originalSend = external.sendMessage.bind(external);
  }

  /** Attaches to the live Photino channel. Call once per page. */
  static attach(router: EventRouter): PhotinoBridge {
    const external = readExternal();
    const bridge = new PhotinoBridge(external, router);

    external.receiveMessage((raw) => { router.dispatchRaw(raw); });

    external.sendMessage = (message: string): void => {
      if (bridge.#shouldDrop(message)) return;
      bridge.#originalSend(message);
    };

    return bridge;
  }

  #shouldDrop(raw: string): boolean {
    if (this.#interceptors.size === 0) return false;
    const action = PhotinoBridge.#actionOf(raw);
    for (const interceptor of this.#interceptors) {
      try {
        if (interceptor(action, raw) === false) return true;
      } catch (error) {
        globalThis.console.error('[vrcnext-plugins] outbound interceptor threw', error);
      }
    }
    return false;
  }

  static #actionOf(raw: string): ActionName {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const action = (parsed as { action?: unknown }).action;
        if (typeof action === 'string') return action;
      }
    } catch {
      // VRCNext only ever sends JSON; anything else is another injected script's traffic.
    }
    return '';
  }

  send(action: ActionName, args: ActionArgs = {}): void {
    this.#originalSend(JSON.stringify({ action, ...args }));
  }

  async request<T extends string>(
    action: ActionName,
    args: ActionArgs,
    options: RequestOptions & { readonly expect: T },
  ): Promise<EventPayload<T>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const onAbort = (): void => { controller.abort(options.signal?.reason); };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${String(timeoutMs)} ms waiting for "${options.expect}".`));
    }, timeoutMs);

    try {
      const pending = this.#router.next(options.expect, controller.signal);
      this.send(action, args);
      return await pending;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  interceptOutbound(interceptor: OutboundInterceptor): () => void {
    this.#interceptors.add(interceptor);
    return (): void => { this.#interceptors.delete(interceptor); };
  }
}
