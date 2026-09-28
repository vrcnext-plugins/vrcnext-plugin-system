/**
 * Deep links VRCNext delivers (`wrld:`, `usr:` and friends).
 *
 * Returning `undefined` means "not handled", so other plugins still see the link. Claim one
 * only when you really are the one acting on it.
 */

import type { Ctx, State } from '../state.js';

export function installDeepLinks(ctx: Ctx, state: State): void {
  ctx.deepLinks.onPrefix('wrld', (event) => {
    state.log(`[link] world ${event.id}`);
    return undefined;
  });

  ctx.deepLinks.on((event) => {
    state.log(`[link] ${event.prefix}:${event.id}${event.action ? ` (${event.action})` : ''}`);
    return undefined;
  });
}
