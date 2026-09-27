/**
 * VRCNext payloads → the API's VRChat types.
 *
 * Every reader takes `unknown` and fills what it cannot find with `''`, `0`, `false` or `[]`.
 * Field names were read out of VRCNext 2026.61.2: `FriendsController` (friends, friend detail,
 * user basic, favourite friends), `AuthController` (favourites, own avatars, `vrcUser`),
 * `MessageRouter` (search, world and avatar detail, recent lists), `GroupsController`,
 * `InstanceController` and `TimelineController`.
 */

import {
  parseLocation,
  type PerformanceRank,
  type VrcAvatar,
  type VrcAvatarSummary,
  type VrcGroup,
  type VrcGroupSummary,
  type VrcFavoriteGroup,
  type VrcInstance,
  type VrcInstanceUser,
  type VrcSelf,
  type VrcTimelineEvent,
  type VrcUser,
  type VrcUserSummary,
  type VrcWorld,
  type VrcWorldSummary,
} from '@vrcnext/plugin-api';

export type Rec = Record<string, unknown>;

export function rec(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : undefined;
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads every object in `value` through `read`, dropping the ones that yield nothing. */
export function each<T>(value: unknown, read: (item: unknown) => T | undefined): readonly T[] {
  return list(value).flatMap((item) => {
    const out = read(item);
    return out === undefined ? [] : [out];
  });
}

const RANKS: readonly PerformanceRank[] = ['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor'];

/** VRCNext spells ranks as VRChat does (`VeryPoor`); anything else is unknown. */
export function rank(value: unknown): PerformanceRank {
  const text = str(value);
  const found = RANKS.find((r) => r.toLowerCase() === text.toLowerCase());
  return found ?? '';
}

// ---------------------------------------------------------------------------------------------
// Users

export function userSummary(value: unknown): VrcUserSummary | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']);
  if (id === '') return undefined;
  return {
    id,
    displayName: str(r['displayName']),
    imageUrl: str(r['image']),
    status: str(r['status']),
    statusDescription: str(r['statusDescription']),
    isFriend: r['isFriend'] === true,
    location: str(r['location']),
    platform: str(r['platform']) || str(r['lastPlatform']),
    tags: strings(r['tags']),
    ageVerificationStatus: str(r['ageVerificationStatus']),
    ageVerified: r['ageVerified'] === true,
  };
}

/** A friend from the `vrcFriends` list is a friend by definition. */
export function friendSummary(value: unknown): VrcUserSummary | undefined {
  const user = userSummary(value);
  return user === undefined ? undefined : { ...user, isFriend: true };
}

export function userDetail(value: unknown): VrcUser | undefined {
  const summary = userSummary(value);
  const r = rec(value);
  if (summary === undefined || r === undefined) return undefined;
  return {
    ...summary,
    bio: str(r['bio']),
    pronouns: str(r['pronouns']),
    dateJoined: str(r['dateJoined']),
    lastLogin: str(r['lastLogin']),
    lastActivity: str(r['lastActivity']),
    lastPlatform: str(r['lastPlatform']),
    currentAvatarId: str(r['currentAvatarId']),
    currentAvatarImageUrl: str(r['currentAvatarImageUrl']),
    worldName: str(r['worldName']),
    instanceType: str(r['instanceType']),
    isEconomyCreator: r['isEconomyCreator'] === true,
    groups: each(r['userGroups'], groupSummary),
    meets: num(r['meets']),
    firstMeetDate: str(r['firstMeetDate']),
    lastSeen: str(r['lastSeenTracked']) || str(r['lastSeen']),
    inSameInstance: r['inSameInstance'] === true,
    totalTimeSeconds: num(r['totalTimeSeconds']),
    note: str(r['note']) || str(r['userNote']),
    memo: str(r['memo']),
  };
}

/** The `vrcUser` push: everything VRCNext knows about the signed-in account. */
export function self(value: unknown): VrcSelf | undefined {
  const summary = userSummary(value);
  const r = rec(value);
  if (summary === undefined || r === undefined) return undefined;
  return {
    ...summary,
    isFriend: false,
    bio: str(r['bio']),
    bioLinks: strings(r['bioLinks']),
    pronouns: str(r['pronouns']),
    languages: strings(r['languages']),
    dateJoined: str(r['dateJoined']),
    lastLogin: str(r['lastLogin']),
    currentAvatarId: str(r['currentAvatar']),
    currentAvatarImageUrl: str(r['currentAvatarImageUrl']),
    homeLocation: str(r['homeLocation']),
    vrcRunning: r['vrcRunning'] === true,
  };
}

/** `vrcFavoriteFriends` again, this time keeping the groups and who is in each. */
export function favoriteGroups(value: unknown): readonly VrcFavoriteGroup[] | undefined {
  const r = rec(value);
  if (r === undefined || !Array.isArray(r['friends'])) return undefined;
  const byGroup = new Map<string, string[]>();
  for (const entry of list(r['friends'])) {
    const f = rec(entry);
    const id = str(f?.['favoriteId']);
    const group = str(f?.['groupName']);
    if (id === '' || group === '') continue;
    const ids = byGroup.get(group) ?? [];
    ids.push(id);
    byGroup.set(group, ids);
  }
  const named = new Map<string, string>();
  for (const entry of list(r['groups'])) {
    const g = rec(entry);
    const name = str(g?.['name']);
    if (name !== '') named.set(name, str(g?.['displayName']));
  }
  // Groups VRCNext listed but nobody is in still belong here; an empty one is a fact.
  const names = new Set([...byGroup.keys(), ...named.keys()]);
  return [...names].map((name) => ({
    name,
    displayName: named.get(name) ?? name,
    userIds: byGroup.get(name) ?? [],
    users: [],
  }));
}

/** `vrcFavoriteFriends`: `{ friends: [{ favoriteId: usr_…, groupName }], groups }`. */
export function favoriteFriendIds(value: unknown): readonly string[] | undefined {
  const r = rec(value);
  if (r === undefined || !Array.isArray(r['friends'])) return undefined;
  return each(r['friends'], (item) => {
    const id = str(rec(item)?.['favoriteId']);
    return id === '' ? undefined : id;
  });
}

// ---------------------------------------------------------------------------------------------
// Avatars

function packageRanks(value: unknown): { pc: PerformanceRank; quest: PerformanceRank; ios: PerformanceRank } {
  let pc: PerformanceRank = '';
  let quest: PerformanceRank = '';
  let ios: PerformanceRank = '';
  for (const item of list(value)) {
    const p = rec(item);
    if (p === undefined || str(p['variant']) === 'impostor') continue;
    const platform = str(p['platform']);
    const rating = rank(p['performanceRating']);
    if (platform === 'standalonewindows' && pc === '') pc = rating;
    else if (platform === 'android' && quest === '') quest = rating;
    else if (platform === 'ios' && ios === '') ios = rating;
  }
  return { pc, quest, ios };
}

export function avatarSummary(value: unknown): VrcAvatarSummary | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']);
  if (id === '') return undefined;
  const fromPackages = packageRanks(r['unityPackages']);
  return {
    id,
    name: str(r['name']),
    authorName: str(r['authorName']),
    imageUrl: str(r['imageUrl']) || str(r['thumbnailImageUrl']),
    thumbnailImageUrl: str(r['thumbnailImageUrl']) || str(r['imageUrl']),
    releaseStatus: str(r['releaseStatus']),
    pcRank: rank(r['pcPerf']) || fromPackages.pc,
    questRank: rank(r['questPerf']) || fromPackages.quest,
    iosRank: rank(r['iosPerf']) || fromPackages.ios,
    tags: strings(r['tags']),
  };
}

export function avatarDetail(value: unknown): VrcAvatar | undefined {
  const summary = avatarSummary(value);
  const r = rec(value);
  if (summary === undefined || r === undefined) return undefined;
  return {
    ...summary,
    authorId: str(r['authorId']),
    description: str(r['description']),
    version: num(r['version']),
    createdAt: str(r['created_at']),
    updatedAt: str(r['updated_at']),
    hasPc: r['hasPC'] === true,
    hasQuest: r['hasQuest'] === true,
    hasIos: r['hasIos'] === true,
    hasImpostor: r['hasImpostor'] === true,
  };
}

// ---------------------------------------------------------------------------------------------
// Worlds

export function worldSummary(value: unknown): VrcWorldSummary | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']);
  if (id === '') return undefined;
  return {
    id,
    name: str(r['name']),
    authorName: str(r['authorName']),
    imageUrl: str(r['imageUrl']) || str(r['thumbnailImageUrl']),
    thumbnailImageUrl: str(r['thumbnailImageUrl']) || str(r['imageUrl']),
    capacity: num(r['capacity']),
    occupants: num(r['occupants']),
    favorites: num(r['favorites']),
    visits: num(r['visits']),
    tags: strings(r['tags']),
    myVisits: num(r['worldVisitCount']),
    myTimeSeconds: num(r['worldTimeSeconds']),
    myLastVisit: str(r['worldLastVisited']),
  };
}

export function worldDetail(value: unknown): VrcWorld | undefined {
  const summary = worldSummary(value);
  const r = rec(value);
  if (summary === undefined || r === undefined) return undefined;
  return {
    ...summary,
    authorId: str(r['authorId']),
    description: str(r['description']),
    recommendedCapacity: num(r['recommendedCapacity']),
    publicOccupants: num(r['publicOccupants']),
    privateOccupants: num(r['privateOccupants']),
    heat: num(r['heat']),
    popularity: num(r['popularity']),
    version: num(r['version']),
    createdAt: str(r['createdAt']) || str(r['created_at']),
    updatedAt: str(r['updatedAt']) || str(r['updated_at']),
  };
}

// ---------------------------------------------------------------------------------------------
// Groups

export function groupSummary(value: unknown): VrcGroupSummary | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']) || str(r['groupId']);
  if (id === '') return undefined;
  return {
    id,
    name: str(r['name']),
    shortCode: str(r['shortCode']),
    iconUrl: str(r['iconUrl']),
    memberCount: num(r['memberCount']) || num(r['members']),
    isJoined: r['isJoined'] === true,
  };
}

export function groupDetail(value: unknown): VrcGroup | undefined {
  const summary = groupSummary(value);
  const r = rec(value);
  if (summary === undefined || r === undefined) return undefined;
  return {
    ...summary,
    discriminator: str(r['discriminator']),
    description: str(r['description']),
    bannerUrl: str(r['bannerUrl']),
    onlineMemberCount: num(r['onlineMemberCount']),
    privacy: str(r['privacy']),
    joinState: str(r['joinState']),
    ownerId: str(r['ownerId']),
    ownerDisplayName: str(r['ownerDisplayName']),
    isRepresenting: r['isRepresenting'] === true,
    isVerified: r['isVerified'] === true,
    createdAt: str(r['createdAt']),
    joinedAt: str(r['joinedAt']),
    rules: str(r['rules']),
    languages: strings(r['languages']),
    links: strings(r['links']),
  };
}

// ---------------------------------------------------------------------------------------------
// Instances and the timeline

function instanceUser(value: unknown): VrcInstanceUser | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const id = str(r['id']);
  const displayName = str(r['displayName']);
  if (id === '' && displayName === '') return undefined;
  return {
    id,
    displayName,
    imageUrl: str(r['image']),
    joinedAt: str(r['joinedAt']),
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
export function instance(value: unknown): VrcInstance | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const location = str(r['location']);
  if (location === '') return undefined;
  const parsed = parseLocation(location);
  return {
    location,
    worldId: str(r['worldId']) || parsed.worldId,
    worldName: str(r['worldName']),
    worldThumbnailUrl: str(r['worldThumb']),
    instanceId: parsed.instanceId,
    instanceType: str(r['instanceType']) || parsed.instanceType,
    groupId: parsed.groupId,
    region: parsed.region,
    userCount: num(r['nUsers']) || list(r['users']).length,
    capacity: num(r['capacity']),
    users: each(r['users'], instanceUser),
  };
}

export function timelineEvent(value: unknown): VrcTimelineEvent | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  return {
    type: str(r['type']),
    timestamp: str(r['timestamp']),
    location: str(r['location']),
    worldName: str(r['worldName']),
  };
}
