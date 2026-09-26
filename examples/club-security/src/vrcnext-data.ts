/**
 * Narrowers for the VRCNext events this plugin consumes.
 *
 * None of these events are in the API's verified map, so every payload arrives as `unknown`.
 * Shapes were read out of VRCNext 2026.61.2: `InstanceController.PushCurrentInstanceFromCache`,
 * `GroupsController` (`vrcGetGroupsForNetwork`), `FriendsController` (`vrcGetInstanceAvatars`)
 * and `MessageRouter` (`vrcGetAvatarDetail`).
 */

export interface InstanceUser {
  readonly id: string;
  readonly displayName: string;
  readonly ageVerified: boolean;
  /** VRChat's own status string, e.g. `18+`, `verified`, `hidden`. Empty until the profile loaded. */
  readonly ageVerificationStatus: string;
  readonly platform: string;
  /** Present once VRCNext fetched the profile; an empty list means it has not yet. */
  readonly tags: readonly string[];
  readonly lastLogin: string;
  readonly avatarId: string;
  readonly avatarName: string;
}

export interface CurrentInstance {
  readonly location: string;
  readonly worldId: string;
  readonly worldName: string;
  readonly instanceType: string;
  /** Parsed from `~group(grp_…)` in the location; empty for non-group instances. */
  readonly groupId: string;
  readonly users: readonly InstanceUser[];
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function groupIdOf(location: string): string {
  const match = /~group\((grp_[0-9a-f-]+)\)/i.exec(location);
  return match?.[1] ?? '';
}

function toInstanceUser(value: unknown): InstanceUser | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']);
  const displayName = str(r['displayName']);
  if (id === '' && displayName === '') return undefined;
  return {
    id,
    displayName,
    ageVerified: r['ageVerified'] === true,
    ageVerificationStatus: str(r['ageVerificationStatus']),
    platform: str(r['platform']),
    tags: strings(r['tags']),
    lastLogin: str(r['lastLogin']),
    avatarId: str(r['avatarId']),
    avatarName: str(r['avatarName']),
  };
}

/** `undefined` for the `{ empty: true }` and `{ error }` variants. */
export function toCurrentInstance(payload: unknown): CurrentInstance | undefined {
  const r = rec(payload);
  if (r === undefined) return undefined;
  const location = str(r['location']);
  if (location === '') return undefined;
  const rawUsers = Array.isArray(r['users']) ? r['users'] : [];
  return {
    location,
    worldId: str(r['worldId']),
    worldName: str(r['worldName']),
    instanceType: str(r['instanceType']),
    groupId: groupIdOf(location),
    users: rawUsers.flatMap((u) => {
      const user = toInstanceUser(u);
      return user === undefined ? [] : [user];
    }),
  };
}

/** VRCNext only fills these once it has fetched the profile from the API. */
export function profileLoaded(user: InstanceUser): boolean {
  return user.ageVerificationStatus !== '' || user.tags.length > 0 || user.lastLogin !== '';
}

export interface UserGroups {
  readonly userId: string;
  readonly groupIds: readonly string[];
}

export function toUserGroups(payload: unknown): UserGroups | undefined {
  const r = rec(payload);
  if (r === undefined) return undefined;
  const userId = str(r['userId']);
  if (userId === '') return undefined;
  const groups = Array.isArray(r['groups']) ? r['groups'] : [];
  return {
    userId,
    groupIds: groups.flatMap((g) => {
      const id = str(rec(g)?.['id']);
      return id === '' ? [] : [id];
    }),
  };
}

export interface InstanceAvatar {
  readonly userId: string;
  readonly avatarId: string;
  readonly avatarName: string;
}

export function toInstanceAvatar(payload: unknown): InstanceAvatar | undefined {
  const r = rec(payload);
  if (r === undefined) return undefined;
  const userId = str(r['userId']);
  if (userId === '') return undefined;
  return { userId, avatarId: str(r['avatarId']), avatarName: str(r['avatarName']) };
}

export interface AvatarPerformance {
  readonly avatarId: string;
  readonly name: string;
  readonly pc: string;
  readonly quest: string;
}

export function toAvatarPerformance(payload: unknown): AvatarPerformance | undefined {
  const r = rec(payload);
  if (r === undefined) return undefined;
  const avatarId = str(r['id']);
  if (avatarId === '') return undefined;
  return {
    avatarId,
    name: str(r['name']),
    pc: str(r['pcPerf']),
    quest: str(r['questPerf']),
  };
}

/** The signed-in account, from the `vrcUser` event VRCNext sends after login. */
export function toSelfId(payload: unknown): string {
  return str(rec(payload)?.['id']);
}
