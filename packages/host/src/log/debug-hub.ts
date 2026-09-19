/**
 * Debug and diagnostics hub.
 *
 * When enabled via settings:
 * - Mirrors uncaught `console.error` and `console.warn` into the host's {@link LogSink} under
 *   scope `"console"`, which streams them in real-time to the native daemon (`plugins.log`).
 * - Emits detailed UI interaction events (navigation clicks, popout triggers, menu actions)
 *   under scope `"ui"` at debug level.
 */

import type { Disposable } from '@vrcnext/plugin-api';

import type { LogSink } from './log-sink.js';

const STORAGE_KEY = 'vrcnext_plugins_debug_mode';

export class DebugHub implements Disposable {
  readonly #sink: LogSink;
  #enabled = false;
  #originalError: ((...args: unknown[]) => void) | undefined;
  #originalWarn: ((...args: unknown[]) => void) | undefined;
  #inHook = false;

  constructor(sink: LogSink) {
    this.#sink = sink;
    this.#loadPersistedState();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    if (this.#enabled === value) return;
    this.#enabled = value;
    this.#persistState();
    if (value) {
      this.#installHook();
      this.#sink.write('info', 'debug', 'Debug logging enabled.', []);
    } else {
      this.#sink.write('info', 'debug', 'Debug logging disabled.', []);
      this.#uninstallHook();
    }
  }

  /** Logs a UI event if debug mode is active. */
  logUi(action: string, detail?: string): void {
    if (!this.#enabled) return;
    const msg = detail !== undefined && detail.length > 0 ? `${action}: ${detail}` : action;
    this.#sink.write('debug', 'ui', msg, []);
  }

  #loadPersistedState(): void {
    try {
      const stored = globalThis.localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') {
        this.#enabled = true;
        this.#installHook();
      }
    } catch {
      // localStorage may be restricted in some environments.
    }
  }

  #persistState(): void {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, this.#enabled ? 'true' : 'false');
    } catch {
      // Ignore storage write errors.
    }
  }

  #installHook(): void {
    if (this.#originalError !== undefined) return;
    const console = globalThis.console;
    this.#originalError = console.error.bind(console);
    this.#originalWarn = console.warn.bind(console);

    console.error = (...args: unknown[]): void => {
      this.#originalError?.(...args);
      this.#capture('error', args);
    };

    console.warn = (...args: unknown[]): void => {
      this.#originalWarn?.(...args);
      this.#capture('warn', args);
    };
  }

  #uninstallHook(): void {
    if (this.#originalError === undefined) return;
    globalThis.console.error = this.#originalError;
    if (this.#originalWarn !== undefined) globalThis.console.warn = this.#originalWarn;
    this.#originalError = undefined;
    this.#originalWarn = undefined;
  }

  #capture(level: 'warn' | 'error', args: readonly unknown[]): void {
    if (this.#inHook) return;
    this.#inHook = true;
    try {
      const text = args
        .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
        .join(' ');
      this.#sink.write(level, 'console', text, []);
    } catch {
      // Never throw out of console interceptor.
    } finally {
      this.#inHook = false;
    }
  }

  dispose(): void {
    this.#uninstallHook();
  }
}
