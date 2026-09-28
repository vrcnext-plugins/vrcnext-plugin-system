/**
 * OSC, in and out.
 *
 * VRCNext only speaks OSC on Windows, so every entry point guards on `available` rather than
 * assuming. A plugin that throws here on Linux is a plugin that looks broken to half its users.
 */

import type { Ctx, State } from '../state.js';

export function installOsc(ctx: Ctx, state: State): void {
  if (!ctx.osc.available) {
    state.log('[osc] OSC is Windows-only in VRCNext; skipping.');
    return;
  }
  ctx.osc.connect();

  ctx.osc.onParam((event) => {
    state.oscParamCount += 1;
    if (ctx.settings.get('verbosity') === 'loud') {
      state.log(`[osc] ${event.name} = ${String(event.value)}`);
    }
  });

  ctx.osc.onAvatarChange((event) => {
    state.log(`[osc] avatar ${event.avatarId} with ${String(event.parameters.length)} parameters`);
  });
}

/** Sends the configured parameter. Shared by the dashboard button and the HTTP route. */
export function pulseOsc(ctx: Ctx): string {
  if (!ctx.osc.available) return 'OSC unavailable (Windows only)';
  const name = ctx.settings.get('oscParameter');
  const value = ctx.settings.get('oscValue');
  ctx.osc.send(name, 'int', value);
  return `${name} = ${String(value)}`;
}
