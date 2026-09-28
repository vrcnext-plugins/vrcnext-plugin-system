/**
 * The VRCNext Bridge: VR overlay and desktop notification targets.
 *
 * The bridge is connected whenever a plugin runs, so there is nothing to probe. Each
 * `service/method` is confirmed by the user the first time it is called: `notify/targets` here,
 * `notify/send` on the first notification.
 *
 * Note the two-step — ask what targets exist, then address them by name. Hard-coding `'wayvr'`
 * would break the moment someone runs a different overlay.
 */

import type { Ctx, State } from '../state.js';

export async function installNative(ctx: Ctx, state: State): Promise<void> {
  let targets: readonly { readonly name: string }[];
  try {
    targets = await ctx.native.targets();
  } catch (error) {
    state.log(`[native] not allowed to list targets: ${String(error)}`);
    return;
  }
  state.log(`[native] targets: ${targets.map((t) => t.name).join(', ') || 'none'}`);

  ctx.gameLog.onType('gl_player_join', (entry) => {
    const who = entry.message;

    // One call, presented differently in each place: a tall translucent panel in VR, an
    // ordinary toast on the monitor. Omitting `sinks` means "every target the bridge has".
    void ctx.native
      .notify({
        title: 'Player joined',
        content: who,
        timeoutSecs: 4,
        icon: 'user-available',
        overrides: {
          wayvr: { content: `${who} joined the instance`, height: 200, opacity: 0.85, alwaysShow: true },
        },
      })
      .catch((error: unknown) => {
        state.log(`[native] ${String(error)}`);
      });
  });

  // VR only — deliberately nothing on the monitor, because this fires often.
  ctx.events.on('friendTimelineEvent', (payload) => {
    if (payload.type !== 'online') return;
    void ctx.native
      .notify({ title: payload.friendName, content: 'came online', sinks: ['wayvr'], timeoutSecs: 3, opacity: 0.7 })
      .catch((error: unknown) => {
        state.log(`[native] ${String(error)}`);
      });
  });
}
