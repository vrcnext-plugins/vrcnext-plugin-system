/**
 * Deep links and in-page routes.
 *
 * > [!IMPORTANT]
 * > **VRCNext cannot deliver a custom `vrcn://` prefix to a plugin.** `DeepLinkService.Parse`
 * > validates the type segment against a closed list (`user`, `avatar`, `world`, `group`,
 * > `instance`, `instance-join`) and returns null for anything else, so an unknown prefix is
 * > dropped in C# and never reaches the page. Registering `vrcn://my-plugin/...` would require
 * > modifying VRCNext, which this project does not do.
 * >
 * > What a plugin *can* do is documented below: observe the links VRCNext does deliver, and
 * > own a namespace under the in-page router.
 */

export const DEEP_LINK_PREFIXES = ['usr', 'avtr', 'wrld', 'grp', 'inst', 'instjoin'] as const;
export type DeepLinkPrefix = (typeof DEEP_LINK_PREFIXES)[number];

export interface DeepLinkEvent {
  readonly prefix: DeepLinkPrefix;
  readonly id: string;
  /** `put/fav1`–`put/fav6`, or empty. The only action VRCNext parses. */
  readonly action: string;
}

export interface DeepLinkApi {
  /**
   * Observes deep links VRCNext delivered. Returning `true` marks the link handled, which stops
   * later plugin handlers — it cannot stop VRCNext's own handling, which already ran.
   */
  on(listener: (event: DeepLinkEvent) => boolean | undefined): () => void;

  /** Observes only one prefix. */
  onPrefix(
    prefix: DeepLinkPrefix,
    listener: (event: DeepLinkEvent) => boolean | undefined,
  ): () => void;
}

/** Request passed to a plugin route handler. */
export interface RouteRequest {
  readonly method: string;
  readonly url: URL;
  /** Path segments captured from the pattern, e.g. `/users/:id` → `{ id: '…' }`. */
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Headers;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}

export type RouteHandler = (request: RouteRequest) => Response | Promise<Response>;

/**
 * In-page HTTP router.
 *
 * > [!WARNING]
 * > **These routes are reachable from inside the VRCNext page only.** VRCNext's real HTTP
 * > listener is a C# `HttpListener` serving a fixed route table; the page cannot add to it.
 * > The router works by intercepting `fetch` for a reserved prefix, so another plugin, injected
 * > code, or a devtools console can call a route — but `curl` from outside cannot, because an
 * > external request never passes through the page.
 */
export interface RouterApi {
  /** Base every route of this plugin hangs off, `/plugins/<plugin-id>/`. */
  readonly base: URL;

  /**
   * Registers a handler. `pattern` is relative to {@link base} and may contain `:name`
   * segments. Registering the same method and pattern twice throws.
   */
  route(method: string, pattern: string, handler: RouteHandler): () => void;

  get(pattern: string, handler: RouteHandler): () => void;
  post(pattern: string, handler: RouteHandler): () => void;

  /** Calls a route on any plugin, including another plugin's. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}
