/**
 * Outbound HTTP.
 *
 * The only `fetch` a plugin has. The bridge refuses to install a plugin whose source calls the
 * bare global, so every request goes through here, where the host checks the URL's host against
 * the manifest's `hosts` list and ties the request to the plugin's lifetime.
 */

/**
 * Headers a plugin's request may never carry, whichever way the request leaves.
 *
 * This machine holds two credentials a third party must never see: the bridge's pairing token,
 * which grants everything the bridge can do, and the page's VRChat session. A request is refused
 * if it names one of these, and no request ever sends cookies — so neither can leave by accident
 * either, however the host's own plumbing changes later.
 *
 * To authenticate to an API, use the scheme that API names: a query parameter, or its own header,
 * such as `X-Api-Key`.
 */
export const CREDENTIAL_HEADERS: readonly string[] = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'];

/** Whether `name` is one of {@link CREDENTIAL_HEADERS}, however it is capitalised. */
export function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADERS.includes(name.trim().toLowerCase());
}

export interface HttpApi {
  /**
   * `fetch`, limited to the hosts declared in `plugin.json`.
   *
   * The plugin's abort signal is always attached: a request still in flight when the plugin is
   * disabled is cancelled, whether or not `init.signal` was given. Any signal passed in `init`
   * is honoured too.
   *
   * Cookies are never sent, and a request naming one of {@link CREDENTIAL_HEADERS} — or a URL
   * carrying `user:password@` — is refused rather than sent without them.
   *
   * @throws {PermissionError} without the `network` grant, for a host not in the allowlist, or
   * for a request that carries credentials.
   */
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}
