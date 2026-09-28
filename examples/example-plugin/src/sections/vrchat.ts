/**
 * VRChat data, without opening a dialog.
 *
 * `ctx.vrchat` reads what VRCNext already knows (friends, favourites, your groups, the instance
 * you are in) and looks up users, avatars, worlds and groups quietly — asking VRCNext the same
 * way its own modals do, but keeping the reply so nothing appears on screen.
 *
 * Never send `vrcGetFriendDetail`-style actions yourself: VRCNext's dispatcher paints a modal
 * for those replies, and the user's screen changes under them.
 */

import type { Ctx, State } from '../state.js';

export async function installVrchatData(ctx: Ctx, state: State): Promise<void> {
  try {
    const [friends, groups, instance] = await Promise.all([
      ctx.vrchat.friends(),
      ctx.vrchat.myGroups(),
      ctx.vrchat.currentInstance(),
    ]);
    state.log(`[vrchat] ${String(friends.length)} friends, ${String(groups.length)} groups`);
    if (instance === undefined) return;

    state.log(
      `[vrchat] in ${instance.worldName} (${instance.instanceType}), ${String(instance.userCount)} here`,
    );
    const other = instance.users.find((u) => u.id !== '' && u.id !== ctx.vrchat.self()?.id);
    if (other === undefined) return;

    const avatar = await ctx.vrchat.instanceAvatar(other.id);
    const detail = avatar === undefined ? undefined : await ctx.vrchat.avatar(avatar.avatarId);
    const rank = detail?.pcRank === undefined || detail.pcRank === '' ? '?' : detail.pcRank;
    state.log(`[vrchat] ${other.displayName} wears ${detail?.name ?? 'an unknown avatar'} (PC ${rank})`);
  } catch (error) {
    // A denied permission is a normal outcome, not a crash.
    ctx.logger.info(`VRChat data unavailable: ${String(error)}`);
  }
}
