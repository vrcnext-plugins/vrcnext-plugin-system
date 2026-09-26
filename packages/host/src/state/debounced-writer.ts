/**
 * Coalesces writes to the state service.
 *
 * A slider setting fires on every step, and a plugin may write a counter on every event; the
 * state file is rewritten atomically on each `set`, so every write costs a rename on the bridge.
 * Writes are held for a short window and only the last value per key goes out.
 */

import type { StateService } from './state-service.js';

export const WRITE_DEBOUNCE_MS = 200;

export class DebouncedWriter {
  readonly #service: StateService;
  readonly #ns: string;
  readonly #onError: (error: unknown) => void;
  readonly #pending = new Map<string, unknown>();
  readonly #waiters: (() => void)[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> = Promise.resolve();

  constructor(service: StateService, ns: string, onError: (error: unknown) => void) {
    this.#service = service;
    this.#ns = ns;
    this.#onError = onError;
  }

  /** Queue a value. Resolves once it (or a later value for the same key) has been written. */
  set(key: string, value: unknown): Promise<void> {
    this.#pending.set(key, value);
    this.#timer ??= globalThis.setTimeout(() => { this.#flush(); }, WRITE_DEBOUNCE_MS);
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  /** Send everything queued now. */
  flush(): Promise<void> {
    if (this.#timer !== undefined) {
      globalThis.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#flush();
    return this.#inFlight;
  }

  #flush(): void {
    this.#timer = undefined;
    const batch = [...this.#pending];
    const waiters = this.#waiters.splice(0);
    this.#pending.clear();
    // Serialised so two flushes cannot land out of order on the bridge.
    this.#inFlight = this.#inFlight.then(async () => {
      for (const [key, value] of batch) {
        try {
          await this.#service.set(this.#ns, key, value);
        } catch (error) {
          this.#onError(error);
        }
      }
      for (const resolve of waiters) resolve();
    });
  }
}
