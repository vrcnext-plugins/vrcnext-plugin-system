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

/** Per-request ceiling. The companion is local; anything slower than this is hung, not busy. */
const TIMEOUT_MS = 4_000;

const UNAVAILABLE: NativeNotifyResult = { ok: false, delivered: [], failed: [] };

interface ErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class NativeClient implements NativeApi {
  readonly #endpoint: string;
  readonly #logger: Logger;
  #available = false;

  constructor(logger: Logger, endpoint: string = DEFAULT_NATIVE_ENDPOINT) {
    this.#logger = logger;
    this.#endpoint = endpoint.replace(/\/+$/, '');
  }

  get available(): boolean {
    return this.#available;
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
      this.#available = false;
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

      if (!response.ok) {
        const details = parsed as ErrorBody;
        const message = details.error?.message ?? `HTTP ${String(response.status)}`;
        throw new Error(`${details.error?.code ?? 'error'}: ${message}`);
      }

      this.#available = true;
      return parsed;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}
