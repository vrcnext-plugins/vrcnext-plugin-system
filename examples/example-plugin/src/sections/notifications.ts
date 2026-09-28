/**
 * Every notification surface VRCNext exposes, from one category.
 *
 * `toast` always works. `desktop` reaches the OS tray and the SteamVR wrist overlay in one
 * call, but only on Windows — on Linux the same job is done by the bridge; see `native.ts`.
 */

import type { Ctx, State } from '../state.js';

export function installNotifications(ctx: Ctx, state: State): void {
  ctx.gameLog.onType('gl_player_join', (entry) => {
    const who = entry.message;
    ctx.notifications.toast({ message: `${who} joined.` });

    if (ctx.notifications.desktopAvailable) {
      ctx.notifications.desktop({ title: 'Player joined', subtitle: who, accent: 'info' });
    } else {
      state.log('[notify] desktop/VR notifications are Windows-only; the bridge covers Linux.');
    }
  });

  // Styled like one of VRCNext's own notification kinds.
  ctx.events.on('friendTimelineEvent', (payload) => {
    if (payload.type !== 'online') return;
    ctx.notifications.notifToast({
      kind: 'notification',
      sender: payload.friendName,
      message: 'came online',
    });
  });
}
