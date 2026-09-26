/**
 * Outbound HTTP.
 *
 * The only `fetch` a plugin has. The bridge refuses to install a plugin whose source calls the
 * bare global, so every request goes through here, where the host checks the URL's host against
 * the manifest's `hosts` list and ties the request to the plugin's lifetime.
 */

export interface HttpApi {
  /**
   * `fetch`, limited to the hosts declared in `plugin.json`.
   *
   * The plugin's abort signal is always attached: a request still in flight when the plugin is
   * disabled is cancelled, whether or not `init.signal` was given. Any signal passed in `init`
   * is honoured too.
   *
   * @throws {PermissionError} without the `network` grant, or for a host not in the allowlist.
   */
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}
