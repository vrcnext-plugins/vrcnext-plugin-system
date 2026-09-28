/**
 * Host events: the typed map, the untyped escape hatch, and what each costs.
 *
 * `friendTimelineEvent` and `vrcCurrentInstance` are listed in `plugin.json`, so they are
 * granted the moment the user enables the plugin. `onAny` is not, and cannot be — it is a
 * request to see *every* event, which the user is asked about once.
 */

import type { Ctx, State } from '../state.js';

export function installEvents(ctx: Ctx, state: State): void {
  // Fully typed: `payload.friendName` is a string.
  ctx.events.on('friendTimelineEvent', (payload) => {
    state.log(`[friend] ${payload.friendName} → ${payload.type}`);
  });

  // Not in the verified map, so the payload is `unknown` and must be narrowed.
  ctx.events.on('vrcCurrentInstance', (payload) => {
    if (typeof payload !== 'object' || payload === null) return;
    const worldName = (payload as { worldName?: unknown }).worldName;
    if (typeof worldName === 'string') state.log(`[instance] now in ${worldName}`);
  });

  if (ctx.settings.get('verbosity') === 'loud') {
    ctx.events.onAny((envelope) => {
      ctx.logger.debug(`event ${envelope.type}`);
    });
  }
}

/** Settings changes. `values` keeps its literal types, so `verbosity` is the union, not `string`. */
export function installSettingsWatch(ctx: Ctx): void {
  ctx.disposables.add(
    ctx.settings.onChange((values) => {
      ctx.logger.debug(`Settings changed; verbosity is now ${values.verbosity}.`);
    }),
  );
}
