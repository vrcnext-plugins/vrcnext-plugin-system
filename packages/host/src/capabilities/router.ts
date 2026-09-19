/**
 * In-page HTTP router.
 *
 * Installed once per page: `globalThis.fetch` is wrapped, and requests under `/plugins/` are
 * answered from the route table instead of hitting VRCNext's C# listener. Anything else is
 * delegated to the captured original fetch, so normal traffic is untouched.
 *
 * This cannot make routes reachable from outside the page — an external request never passes
 * through `fetch`. See `RouterApi` in the API package for the full caveat.
 */

import type { PluginId, RouteHandler, RouterApi, RouteRequest } from '@vrcnext/plugin-api';

export const ROUTE_PREFIX = '/plugins/';

interface RouteEntry {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
  readonly pluginId: PluginId;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Matches a request path against a pattern, returning captured `:name` params. */
function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const value = actual[index];
    if (value === undefined) return undefined;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (expected !== value) return undefined;
  }
  return params;
}

export class RouteTable {
  readonly #routes = new Set<RouteEntry>();
  /** Base for resolving relative request URLs. Injected so the table has no global dependency. */
  readonly #base: string;
  /** The exact reference to restore, so install/uninstall cycles do not stack bind layers. */
  #originalFetch: typeof globalThis.fetch | undefined;

  constructor(base: string) {
    this.#base = base;
  }

  /** Wraps `fetch`. Idempotent. */
  install(): void {
    if (this.#originalFetch !== undefined) return;
    this.#originalFetch = globalThis.fetch;
    // Native fetch throws "Illegal invocation" when called detached, so bind for calling only.
    const original = globalThis.fetch.bind(globalThis);

    globalThis.fetch = async (input, init): Promise<Response> => {
      const url = this.#urlOf(input);
      if (!url?.pathname.startsWith(ROUTE_PREFIX)) {
        return await original(input, init);
      }
      const response = await this.#dispatch(url, input, init);
      return response ?? new Response('No plugin route matched.', { status: 404 });
    };
  }

  uninstall(): void {
    if (this.#originalFetch === undefined) return;
    globalThis.fetch = this.#originalFetch;
    this.#originalFetch = undefined;
    this.#routes.clear();
  }

  #urlOf(input: RequestInfo | URL): URL | undefined {
    try {
      if (input instanceof URL) return input;
      if (typeof input === 'string') return new URL(input, this.#base);
      return new URL(input.url);
    } catch {
      return undefined;
    }
  }

  async #dispatch(
    url: URL,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response | undefined> {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const actual = splitPath(url.pathname.slice(ROUTE_PREFIX.length));

    for (const entry of this.#routes) {
      if (entry.method !== method) continue;
      const params = matchSegments(entry.segments, actual);
      if (params === undefined) continue;

      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
      const request = RouteTable.#buildRequest({ method, url, params, init, body });
      try {
        return await entry.handler(request);
      } catch (error) {
        globalThis.console.error(`[vrcnext-plugins:${entry.pluginId}] route threw`, error);
        return new Response('The plugin route failed.', { status: 500 });
      }
    }
    return undefined;
  }

  static #buildRequest(parts: {
    readonly method: string;
    readonly url: URL;
    readonly params: Readonly<Record<string, string>>;
    readonly init: RequestInit | undefined;
    readonly body: BodyInit | null | undefined;
  }): RouteRequest {
    const { method, url, params, init, body } = parts;
    const read = (): string => (typeof body === 'string' ? body : '');
    return {
      method,
      url,
      params,
      headers: new Headers(init?.headers),
      text: (): Promise<string> => Promise.resolve(read()),
      json: <T,>(): Promise<T> => Promise.resolve(JSON.parse(read()) as T),
    };
  }

  register(entry: RouteEntry): () => void {
    for (const existing of this.#routes) {
      if (
        existing.method === entry.method &&
        existing.segments.join('/') === entry.segments.join('/')
      ) {
        throw new Error(`Route ${entry.method} ${entry.segments.join('/')} is already registered.`);
      }
    }
    this.#routes.add(entry);
    return (): void => {
      this.#routes.delete(entry);
    };
  }
}

export class PluginRouter implements RouterApi {
  readonly base: URL;
  readonly #table: RouteTable;
  readonly #pluginId: PluginId;
  readonly #register: (dispose: () => void) => void;

  constructor(
    table: RouteTable,
    pluginId: PluginId,
    origin: string,
    register: (dispose: () => void) => void,
  ) {
    this.#table = table;
    this.#pluginId = pluginId;
    this.#register = register;
    this.base = new URL(`${ROUTE_PREFIX}${pluginId}/`, origin);
  }

  route(method: string, pattern: string, handler: RouteHandler): () => void {
    const segments = [this.#pluginId, ...splitPath(pattern)];
    const dispose = this.#table.register({
      method: method.toUpperCase(),
      segments,
      handler,
      pluginId: this.#pluginId,
    });
    this.#register(dispose);
    return dispose;
  }

  get(pattern: string, handler: RouteHandler): () => void {
    return this.route('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): () => void {
    return this.route('POST', pattern, handler);
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return await globalThis.fetch(new URL(input, this.base), init);
  }
}
