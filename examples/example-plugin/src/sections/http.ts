/**
 * Outbound HTTP, behind an optional permission.
 *
 * `network` is in `optionalPermissions`, so the plugin asks for the category when it first
 * needs it rather than at enable time; `api.github.com` is pre-declared in `hosts`, so once the
 * category is granted the request goes through without a second prompt. A host that is not
 * listed prompts again, per host.
 *
 * `ctx.http.fetch` is the only HTTP a plugin can do; calling the page’s own is refused at
 * install, which is also why this comment does not spell it — the scan reads comments too.
 */

import type { Ctx } from '../state.js';

export async function fetchStars(ctx: Ctx): Promise<string> {
  if (!(await ctx.permissions.request('network'))) return 'Network access declined.';
  const response = await ctx.http.fetch(
    'https://api.github.com/repos/vrcnext-plugins/vrcnext-plugin-system',
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  const body = (await response.json()) as { stargazers_count?: unknown };
  return typeof body.stargazers_count === 'number'
    ? `${String(body.stargazers_count)} stars`
    : `HTTP ${String(response.status)}`;
}
