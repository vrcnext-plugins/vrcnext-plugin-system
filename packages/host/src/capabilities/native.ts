/**
 * Client for the optional `vrcnext-bridge` companion.
 *
 * The companion is the only way a plugin reaches a UDP socket, D-Bus or a unix socket, because the
 * page itself cannot. Everything here is written for the case where it is **not installed**: that
 * is the normal state for most users, and it must produce a clean "unavailable", never a rejected
 * promise a plugin forgot to catch.
 *
 * Requests deliberately send `Content-Type: application/json`, which makes them non-simple and
 * forces a CORS preflight. That is not incidental — it is half of the companion's defence against
 * arbitrary web pages reaching it, and sending anything else would be quietly weakening it.
 */

import type {
  Logger,
  NativeApi,
  NativeDescription,
  NativeNotifyOptions,
  NativeNotifyResult,
  NativeTarget,
} from '@vrcnext/plugin-api';

/** Where the companion listens unless the user moved it. */
export const DEFAULT_NATIVE_ENDPOINT = 'http://127.0.0.1:42081';

/** Where a user-chosen endpoint is remembered. */
const ENDPOINT_KEY = 'vrcnext-plugins.native-endpoint';

/**
 * The stored endpoint, or the default.
 *
 * `localStorage` rather than the host's IndexedDB because this is needed synchronously, during
 * construction, before the async storage layer is ready.
 */
export function storedEndpoint(): string {
  try {
    return globalThis.localStorage.getItem(ENDPOINT_KEY) ?? DEFAULT_NATIVE_ENDPOINT;
  } catch {
    return DEFAULT_NATIVE_ENDPOINT;
  }
}

/** Per-request ceiling. The companion is local; anything slower than this is hung, not busy. */
const TIMEOUT_MS = 4_000;

const UNAVAILABLE: NativeNotifyResult = { ok: false, delivered: [], failed: [] };

interface ErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

/**
 * The companion answered, and said no.
 *
 * Distinct from a transport failure on purpose: a 400 means the daemon is running and working —
 * the *request* was wrong. Conflating the two would let one malformed notification mark a
 * perfectly healthy companion as unavailable for the rest of the session.
 */
export class NativeRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(`${code}: ${message}`);
    this.name = 'NativeRequestError';
    this.code = code;
    this.status = status;
  }
}

export class NativeClient implements NativeApi {
  #endpoint: string;
  readonly #logger: Logger;
  #available = false;
  #ready: Promise<boolean> | undefined;

  constructor(logger: Logger, endpoint: string = storedEndpoint()) {
    this.#logger = logger;
    this.#endpoint = NativeClient.#normalise(endpoint);
  }

  static #normalise(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
  }

  /**
   * Point at a different companion, persist the choice, and re-probe.
   *
   * The bridge's `--listen` is configurable, so this has to be too — otherwise a user who moves
   * the daemon has no way to tell the host, short of editing the bundle.
   *
   * @returns whether the new endpoint answered.
   */
  async setEndpoint(endpoint: string): Promise<boolean> {
    const next = NativeClient.#normalise(endpoint) || DEFAULT_NATIVE_ENDPOINT;
    this.#endpoint = next;
    this.#ready = undefined;
    try {
      if (next === DEFAULT_NATIVE_ENDPOINT) globalThis.localStorage.removeItem(ENDPOINT_KEY);
      else globalThis.localStorage.setItem(ENDPOINT_KEY, next);
    } catch {
      this.#logger.warn('Could not persist the companion endpoint; it will reset on reload.');
    }
    return this.probe();
  }

  get available(): boolean {
    return this.#available;
  }

  /**
   * The boot-time probe, as a promise.
   *
   * {@link available} is a synchronous snapshot, and at the moment a plugin activates the probe
   * may still be in flight — so branching on it directly is a race that resolves differently
   * depending on how fast the daemon answers. Await this instead. Repeated reads share one probe.
   */
  get ready(): Promise<boolean> {
    this.#ready ??= this.probe();
    return this.#ready;
  }

  get endpoint(): string {
    return this.#endpoint;
  }

  async probe(): Promise<boolean> {
    try {
      const health = await this.#request('GET', '/v1/health');
      this.#available = (health as { ok?: unknown }).ok === true;
    } catch {
      // Not running is the common case and not worth a warning on every boot.
      this.#available = false;
    }
    this.#logger.info(
      this.#available
        ? `Native companion reachable at ${this.#endpoint}.`
        : `No native companion at ${this.#endpoint}; VR and desktop notification targets are unavailable.`,
    );
    return this.#available;
  }

  async describe(): Promise<NativeDescription | undefined> {
    try {
      return (await this.#request('GET', '/v1/describe')) as NativeDescription;
    } catch (error) {
      this.#logger.debug(`describe() failed: ${String(error)}`);
      return undefined;
    }
  }

  async targets(): Promise<readonly NativeTarget[]> {
    try {
      const body = await this.#request('POST', '/v1/notify/targets', {});
      const targets = (body as { targets?: unknown }).targets;
      return Array.isArray(targets) ? (targets as NativeTarget[]) : [];
    } catch (error) {
      this.#logger.debug(`targets() failed: ${String(error)}`);
      return [];
    }
  }

  async notify(options: NativeNotifyOptions): Promise<NativeNotifyResult> {
    try {
      const body = await this.#request('POST', '/v1/notify/send', options);
      return body as NativeNotifyResult;
    } catch (error) {
      // Only a transport failure says anything about availability. A rejected request means the
      // companion is alive and the caller got it wrong.
      if (!(error instanceof NativeRequestError)) this.#available = false;
      this.#logger.warn(`Native notification failed: ${String(error)}`);
      return UNAVAILABLE;
    }
  }

  async call(service: string, method: string, params: unknown = {}): Promise<unknown> {
    return this.#request('POST', `/v1/${service}/${method}`, params);
  }

  /**
   * One request, with its own timeout.
   *
   * A non-2xx answer carries the companion's own error code and message; surfacing that verbatim
   * is far more useful to a plugin author than "HTTP 400".
   */
  async #request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, TIMEOUT_MS);

    try {
      const response = await globalThis.fetch(`${this.#endpoint}${path}`, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      const parsed: unknown = text === '' ? {} : JSON.parse(text);

      // Reached it either way, so record that before deciding whether the answer was a refusal.
      this.#available = true;

      if (!response.ok) {
        const details = parsed as ErrorBody;
        throw new NativeRequestError(
          details.error?.code ?? 'error',
          response.status,
          details.error?.message ?? `HTTP ${String(response.status)}`,
        );
      }
      return parsed;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}
