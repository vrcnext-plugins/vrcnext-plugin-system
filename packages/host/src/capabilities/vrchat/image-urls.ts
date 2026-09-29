/**
 * Turning VRCNext's image-cache keys back into the addresses VRChat serves.
 *
 * VRCNext downloads every picture it shows and hands the page a `http://localhost:…/imgcache/…`
 * address for its copy. That is the right thing for painting the app and worthless anywhere the
 * address has to leave this machine — a Discord embed, a webhook — where it fails silently: the
 * remote end fetches nothing and renders a field with no picture.
 *
 * VRCNext did record where each picture came from, in `image_versions` in its own database, so it
 * can tell when VRChat has replaced one. The bridge can read that table; the page cannot read
 * anything. So the resolution lives here, one indexed lookup per key.
 */

import type { RequestOptions } from '@vrcnext/plugin-api';

/** What the bridge's `sql.query` answers with. Only the shape this needs. */
interface QueryAnswer {
  readonly rows?: readonly { readonly url?: unknown }[];
}

/** `BridgeClient.call`, as much of it as this needs. */
export type BridgeCall = (
  service: string,
  method: string,
  params?: unknown,
  options?: RequestOptions,
) => Promise<unknown>;

/**
 * The public address for one cache key, or `''`.
 *
 * `''` covers every way this can come up empty — no bridge, no such row, an answer that is not
 * the shape expected — because the caller does the same thing with all of them: leave the picture
 * out. The key is bound as a parameter, never spliced into the statement.
 */
export async function resolveImageUrl(call: BridgeCall | undefined, key: string): Promise<string> {
  if (call === undefined) return '';
  const answer = await call('sql', 'query', {
    database: 'vrcnext',
    sql: 'SELECT url FROM image_versions WHERE key = ?1',
    params: [key],
  });
  const rows = (answer as QueryAnswer | undefined)?.rows;
  const url = rows === undefined ? undefined : rows[0]?.url;
  return typeof url === 'string' ? url : '';
}
