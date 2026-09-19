/**
 * Teardown primitives.
 *
 * VRCNext unloads a theme by dropping its `<script>` element, which does nothing to listeners,
 * timers or observers the script installed. Everything a plugin starts must therefore be
 * registered here so the host can reverse it on deactivate.
 */

export interface Disposable {
  dispose(): void;
}

export type DisposeFn = () => void;

/**
 * Collects teardown callbacks and runs them in reverse registration order, so resources are
 * released in the opposite order they were acquired.
 */
export class DisposableBag implements Disposable {
  #disposers: DisposeFn[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Registers a teardown callback. Runs it immediately if the bag is already disposed. */
  add(disposer: DisposeFn | Disposable): void {
    const fn = typeof disposer === 'function' ? disposer : (): void => { disposer.dispose(); };
    if (this.#disposed) {
      fn();
      return;
    }
    this.#disposers.push(fn);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const disposers = this.#disposers;
    this.#disposers = [];
    // Reverse order, and one failure must not strand the remaining teardowns.
    for (let i = disposers.length - 1; i >= 0; i--) {
      const fn = disposers[i];
      if (fn === undefined) continue;
      try {
        fn();
      } catch (error) {
        globalThis.console.error('[vrcnext-plugins] teardown failed', error);
      }
    }
  }
}
