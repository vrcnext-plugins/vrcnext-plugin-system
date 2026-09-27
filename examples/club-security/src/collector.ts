/**
 * Gathers everything the report needs about one joiner, within a deadline.
 *
 * Each fact comes from a different VRCNext path, so they are collected in parallel and each one
 * degrades to "unknown" on its own timeout rather than holding up the report:
 *
 * - Age verification: VRCNext fetches the joiner's profile itself and re-pushes
 *   `vrcCurrentInstance` once it has, so this waits for that push instead of making a request.
 * - Group membership: `vrcGetGroupsForNetwork` lists the groups the user shows publicly. A member
 *   who hides that membership looks like a non-member; the report says "visible" for that reason.
 * - Avatar: `vrcGetInstanceAvatars` resolves the avatar id from the profile image through
 *   VRCNext's avatar databases, then `vrcGetAvatarDetail` supplies the performance ranks. That
 *   action also feeds VRCNext's avatar modal, so it is skipped while that modal is open.
 */

import type { EventBus, PluginContext } from '@vrcnext/plugin-api';

import type { InstanceFilter } from './filters.js';
import { rejoinIn, toTimelineEntries, UNKNOWN_REJOIN, type Rejoin } from './history.js';
import type { Settings } from './settings.js';
import {
  profileLoaded,
  toAvatarPerformance,
  toCurrentInstance,
  toInstanceAvatar,
  toUserGroups,
  type CurrentInstance,
  type InstanceUser,
} from './vrcnext-data.js';

export interface Joiner {
  readonly name: string;
  /** Empty for accounts VRChat still logs with a legacy id. */
  readonly userId: string;
}

export interface AvatarFacts {
  readonly name: string;
  readonly pc: string;
  readonly quest: string;
}

export interface Facts {
  readonly ageVerified: boolean | undefined;
  readonly ageStatus: string;
  readonly platform: string;
  readonly avatar: AvatarFacts | undefined;
  /** `undefined` when no group filter is configured. */
  readonly inGroup: boolean | undefined;
  readonly rejoin: Rejoin;
}

type Ctx = PluginContext<Settings>;

/** Resolves with the first event `pick` accepts, or `undefined` on timeout or abort. */
function waitFor<T>(
  events: EventBus,
  type: string,
  pick: (payload: unknown) => T | undefined,
  options: { readonly ms: number; readonly signal: AbortSignal },
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | undefined): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      options.signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => { finish(undefined); };
    const timer = setTimeout(() => { finish(undefined); }, options.ms);
    const unsubscribe = events.on(type, (payload) => {
      const value = pick(payload);
      if (value !== undefined) finish(value);
    });
    options.signal.addEventListener('abort', onAbort, { once: true });
  });
}

function findUser(instance: CurrentInstance, joiner: Joiner): InstanceUser | undefined {
  return instance.users.find((u) =>
    joiner.userId !== '' ? u.id === joiner.userId : u.displayName === joiner.name,
  );
}

function avatarModalOpen(): boolean {
  const modal = document.getElementById('modalAvatarDetail');
  return modal !== null && modal.offsetParent !== null;
}

export class FactCollector {
  readonly #ctx: Ctx;
  #latest: CurrentInstance | undefined;
  /** Performance ranks by avatar id, so a popular avatar is only fetched once. */
  readonly #perfCache = new Map<string, AvatarFacts>();

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    ctx.events.on('vrcCurrentInstance', (payload) => {
      const instance = toCurrentInstance(payload);
      if (instance !== undefined) this.#latest = instance;
    });
    ctx.events.on('vrcAvatarDetail', (payload) => {
      const perf = toAvatarPerformance(payload);
      if (perf !== undefined) {
        this.#perfCache.set(perf.avatarId, { name: perf.name, pc: perf.pc, quest: perf.quest });
      }
    });
  }

  get instance(): CurrentInstance | undefined {
    return this.#latest;
  }

  /** Runs every lookup in parallel and returns whatever arrived before the deadline. */
  async collect(joiner: Joiner, filter: InstanceFilter, deadlineMs: number): Promise<Facts> {
    const signal = this.#ctx.signal;
    const joinedAt = Date.now();
    const [profile, inGroup, avatar, rejoin] = await Promise.all([
      this.#profile(joiner, deadlineMs, signal),
      filter.groupId === '' ? Promise.resolve(undefined) : this.#membership(joiner, filter.groupId, deadlineMs, signal),
      this.#avatar(joiner, deadlineMs, signal),
      this.#rejoin(joiner, joinedAt, { ms: deadlineMs, signal }),
    ]);
    return {
      ageVerified: profile === undefined ? undefined : profile.ageVerified,
      ageStatus: profile?.ageVerificationStatus ?? '',
      platform: profile?.platform ?? '',
      avatar,
      inGroup,
      rejoin,
    };
  }

  /**
   * Whether VRCNext's timeline already has this player in this exact instance. Legacy accounts
   * without a `usr_` id cannot be looked up.
   */
  async #rejoin(joiner: Joiner, joinedAt: number, window: { readonly ms: number; readonly signal: AbortSignal }): Promise<Rejoin> {
    const location = this.#latest?.location ?? '';
    if (joiner.userId === '' || location === '') return UNKNOWN_REJOIN;
    const pending = waitFor(
      this.#ctx.events,
      'timelineForUser',
      (payload) => toTimelineEntries(payload, joiner.userId),
      window,
    );
    this.#ctx.bridge.send('getTimelineForUser', { userId: joiner.userId });
    return rejoinIn(await pending, location, joinedAt);
  }

  async #profile(joiner: Joiner, ms: number, signal: AbortSignal): Promise<InstanceUser | undefined> {
    const current = this.#latest === undefined ? undefined : findUser(this.#latest, joiner);
    if (current !== undefined && profileLoaded(current)) return current;
    const loaded = await waitFor(
      this.#ctx.events,
      'vrcCurrentInstance',
      (payload) => {
        const instance = toCurrentInstance(payload);
        const user = instance === undefined ? undefined : findUser(instance, joiner);
        return user !== undefined && profileLoaded(user) ? user : undefined;
      },
      { ms, signal },
    );
    // A profile that never loaded still tells us the platform VRChat logged.
    return loaded ?? current;
  }

  async #membership(joiner: Joiner, groupId: string, ms: number, signal: AbortSignal): Promise<boolean | undefined> {
    if (joiner.userId === '') return undefined;
    const wanted = groupId.toLowerCase();
    const pending = waitFor(
      this.#ctx.events,
      'vrcGroupsForNetwork',
      (payload) => {
        const groups = toUserGroups(payload);
        return groups?.userId === joiner.userId ? groups.groupIds : undefined;
      },
      { ms, signal },
    );
    this.#ctx.bridge.send('vrcGetGroupsForNetwork', { userId: joiner.userId });
    const groupIds = await pending;
    return groupIds === undefined ? undefined : groupIds.some((id) => id.toLowerCase() === wanted);
  }

  async #avatar(joiner: Joiner, ms: number, signal: AbortSignal): Promise<AvatarFacts | undefined> {
    if (joiner.userId === '') return undefined;
    const started = Date.now();
    const remaining = (): number => Math.max(1_000, ms - (Date.now() - started));

    let avatarId = this.#latest === undefined ? '' : (findUser(this.#latest, joiner)?.avatarId ?? '');
    let avatarName = '';
    if (avatarId === '') {
      const pending = waitFor(
        this.#ctx.events,
        'vrcInstanceAvatarFound',
        (payload) => {
          const found = toInstanceAvatar(payload);
          return found?.userId === joiner.userId ? found : undefined;
        },
        { ms: remaining(), signal },
      );
      this.#ctx.bridge.send('vrcGetInstanceAvatars', { userIds: [joiner.userId] });
      const found = await pending;
      if (found === undefined) return undefined;
      avatarId = found.avatarId;
      avatarName = found.avatarName;
    }
    if (avatarId === '') return avatarName === '' ? undefined : { name: avatarName, pc: '', quest: '' };

    const cached = this.#perfCache.get(avatarId);
    if (cached !== undefined) return cached;
    if (avatarModalOpen()) {
      this.#ctx.logger.debug('Avatar modal is open; not fetching performance ranks behind it.');
      return { name: avatarName, pc: '', quest: '' };
    }
    const pending = waitFor(
      this.#ctx.events,
      'vrcAvatarDetail',
      (payload) => {
        const perf = toAvatarPerformance(payload);
        return perf?.avatarId === avatarId ? perf : undefined;
      },
      { ms: remaining(), signal },
    );
    this.#ctx.bridge.send('vrcGetAvatarDetail', { avatarId });
    const perf = await pending;
    return perf === undefined
      ? { name: avatarName, pc: '', quest: '' }
      : { name: perf.name === '' ? avatarName : perf.name, pc: perf.pc, quest: perf.quest };
  }
}
