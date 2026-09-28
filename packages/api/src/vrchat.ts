/**
 * VRChat data, read through VRCNext — without its dialogs.
 *
 * VRCNext fetches users, avatars, worlds and groups for its own modals and pushes the result as
 * an event the modal renders. Asking for the same thing through `ctx.bridge` therefore paints
 * that modal, or opens it (an instance-avatar lookup opens the avatar dialog). This API asks
 * quietly: the host sends the request and keeps VRCNext's own handler from seeing the reply, so
 * the plugin gets the data and the screen does not change. Lists VRCNext keeps anyway (friends,
 * favourites, your groups, the current instance, recently seen players) come from the host's
 * mirror of those pushes, refreshed on demand.
 *
 * Everything here is read-only and needs the `vrchat` permission. Shapes were read out of the
 * VRCNext source (2026.61.2); fields VRCNext does not know for a given source are `''`, `0` or
 * `undefined` rather than guessed.
 */

/** VRChat's avatar performance ranks, best to worst. `''` when unknown. */
export const PERFORMANCE_RANKS = ['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor'] as const;
export type PerformanceRank = (typeof PERFORMANCE_RANKS)[number] | '';

/** Where an avatar's rank sits, 0 for Excellent … 4 for VeryPoor; `undefined` when unknown. */
export function rankIndex(rank: string): number | undefined {
  const index = (PERFORMANCE_RANKS as readonly string[]).indexOf(rank);
  return index < 0 ? undefined : index;
}

/** The traffic-light colour VRChat gives each rank, as one emoji. `⚪` when unknown. */
export const RANK_EMOJI: Readonly<Record<PerformanceRank, string>> = {
  Excellent: '🟢', Good: '🔵', Medium: '🟡', Poor: '🟠', VeryPoor: '🔴', '': '⚪',
};

/**
 * The rank as a reader says it: `Very Poor`, not `VeryPoor`; `Unknown` for `''`.
 *
 * VRChat spells the worst rank as one word and nobody reads it that way, so the camel hump is
 * split. Any other string is passed through the same rule rather than rejected, because a rank
 * VRChat adds later should still print.
 */
export function rankLabel(rank: string): string {
  return rank === '' ? 'Unknown' : rank.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** {@link RANK_EMOJI} for a rank that may be any string; `⚪` for one VRChat has not named. */
export function rankEmoji(rank: string): string {
  const known: Readonly<Partial<Record<string, string>>> = RANK_EMOJI;
  return known[rank] ?? RANK_EMOJI[''];
}

/**
 * VRChat's trust ranks as VRCNext names them, best first.
 *
 * The tags are offset by one from the label VRChat shows: someone carrying
 * `system_trust_trusted` is displayed as a *Known* user. VRCNext's own profile badge applies
 * that offset and so does this, so a plugin and the page never disagree about someone's rank.
 */
export const TRUST_RANKS = [
  { tag: 'system_trust_legend', label: 'Trusted User', short: 'Trusted' },
  { tag: 'system_trust_veteran', label: 'Trusted User', short: 'Trusted' },
  { tag: 'system_trust_trusted', label: 'Known User', short: 'Known' },
  { tag: 'system_trust_known', label: 'User', short: 'User' },
  { tag: 'system_trust_basic', label: 'New User', short: 'New' },
] as const;

export interface TrustRank {
  /** As VRChat's profile shows it: `Trusted User`, `Known User`, `User`, `New User`, `Visitor`. */
  readonly label: string;
  /** One word, for somewhere narrow. */
  readonly short: string;
}

const VISITOR: TrustRank = { label: 'Visitor', short: 'Visitor' };

/** The highest rank in `tags`; `Visitor` when none of them is a trust tag. */
export function trustRank(tags: readonly string[]): TrustRank {
  const found = TRUST_RANKS.find((rank) => tags.includes(rank.tag));
  return found === undefined ? VISITOR : { label: found.label, short: found.short };
}

export interface VrcUserSummary {
  readonly id: string;
  readonly displayName: string;
  /**
   * Profile picture, through VRCNext's image cache — a `http://localhost:<port>/imgcache/…`
   * address that only resolves on this machine. Fine in the page; useless in anything that
   * leaves it. For a Discord embed or a webhook use {@link publicImageUrl} on
   * `VrcUser.currentAvatarImageUrl`, which VRChat serves itself.
   */
  readonly imageUrl: string;
  /** `active`, `join me`, `ask me`, `busy`, `offline`. */
  readonly status: string;
  readonly statusDescription: string;
  readonly isFriend: boolean;
  /** Instance location, `private`, `offline` or `''`. Friends only. */
  readonly location: string;
  /** `standalonewindows`, `android`, `ios` or `''`. */
  readonly platform: string;
  readonly tags: readonly string[];
  /** `18+`, `verified`, `hidden` or `''`. */
  readonly ageVerificationStatus: string;
  readonly ageVerified: boolean;
}

/**
 * The signed-in account. VRCNext pushes all of this after login, so it costs nothing to read.
 */
export interface VrcSelf extends VrcUserSummary {
  readonly bio: string;
  readonly bioLinks: readonly string[];
  readonly pronouns: string;
  readonly languages: readonly string[];
  readonly dateJoined: string;
  readonly lastLogin: string;
  readonly currentAvatarId: string;
  readonly currentAvatarImageUrl: string;
  /** Where "go home" goes; `''` when unset. */
  readonly homeLocation: string;
  /** Whether VRChat is running, as VRCNext sees it. */
  readonly vrcRunning: boolean;
}

/** One of your favourite-friend groups, with the names in it. */
export interface VrcFavoriteGroup {
  /** VRChat's own tag, e.g. `group_0`. */
  readonly name: string;
  /** What you renamed it to, e.g. `Besties`. */
  readonly displayName: string;
  readonly userIds: readonly string[];
  /** The members this page knows by name; a non-friend may be missing. */
  readonly users: readonly VrcUserSummary[];
}

/** How many people you have moderated, by kind. */
export interface VrcModerationCounts {
  readonly blocked: number;
  readonly muted: number;
  readonly hiddenAvatar: number;
  readonly interactOff: number;
  readonly muteChat: number;
}

/** A full profile, as VRCNext's user dialog would show it. */
export interface VrcUser extends VrcUserSummary {
  readonly bio: string;
  readonly pronouns: string;
  readonly dateJoined: string;
  readonly lastLogin: string;
  readonly lastActivity: string;
  readonly lastPlatform: string;
  readonly currentAvatarId: string;
  readonly currentAvatarImageUrl: string;
  readonly worldName: string;
  readonly instanceType: string;
  readonly isEconomyCreator: boolean;
  /** Groups the user shows publicly. */
  readonly groups: readonly VrcGroupSummary[];
  /** VRCNext's own records: how often you met, when first, when last. */
  readonly meets: number;
  readonly firstMeetDate: string;
  readonly lastSeen: string;
  readonly inSameInstance: boolean;
  readonly totalTimeSeconds: number;
  readonly note: string;
  readonly memo: string;
}

export interface VrcAvatarSummary {
  readonly id: string;
  readonly name: string;
  readonly authorName: string;
  readonly imageUrl: string;
  readonly thumbnailImageUrl: string;
  /** `public` or `private`. */
  readonly releaseStatus: string;
  readonly pcRank: PerformanceRank;
  readonly questRank: PerformanceRank;
  readonly iosRank: PerformanceRank;
  readonly tags: readonly string[];
}

export interface VrcAvatar extends VrcAvatarSummary {
  readonly authorId: string;
  readonly description: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly hasPc: boolean;
  readonly hasQuest: boolean;
  readonly hasIos: boolean;
  readonly hasImpostor: boolean;
}

export interface VrcWorldSummary {
  readonly id: string;
  readonly name: string;
  readonly authorName: string;
  readonly imageUrl: string;
  readonly thumbnailImageUrl: string;
  readonly capacity: number;
  readonly occupants: number;
  readonly favorites: number;
  readonly visits: number;
  readonly tags: readonly string[];
  /** Your own visits, from VRCNext's records. */
  readonly myVisits: number;
  readonly myTimeSeconds: number;
  readonly myLastVisit: string;
}

export interface VrcWorld extends VrcWorldSummary {
  readonly authorId: string;
  readonly description: string;
  readonly recommendedCapacity: number;
  readonly publicOccupants: number;
  readonly privateOccupants: number;
  readonly heat: number;
  readonly popularity: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VrcGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
  readonly iconUrl: string;
  readonly memberCount: number;
  /** Whether you are a member. */
  readonly isJoined: boolean;
}

export interface VrcGroup extends VrcGroupSummary {
  readonly discriminator: string;
  readonly description: string;
  readonly bannerUrl: string;
  readonly onlineMemberCount: number;
  /** `default`, `private`. */
  readonly privacy: string;
  readonly joinState: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly isRepresenting: boolean;
  readonly isVerified: boolean;
  readonly createdAt: string;
  readonly joinedAt: string;
  readonly rules: string;
  readonly languages: readonly string[];
  readonly links: readonly string[];
}

export interface VrcInstanceUser {
  readonly id: string;
  readonly displayName: string;
  readonly imageUrl: string;
  readonly joinedAt: string;
  readonly ageVerified: boolean;
  readonly ageVerificationStatus: string;
  readonly platform: string;
  readonly tags: readonly string[];
  readonly lastLogin: string;
  /** Present once VRCNext resolved the avatar; `''` until then. */
  readonly avatarId: string;
  readonly avatarName: string;
}

export interface VrcInstance {
  /** `wrld_…:12345~…`, the full location. */
  readonly location: string;
  readonly worldId: string;
  readonly worldName: string;
  readonly worldThumbnailUrl: string;
  /** The part after the colon, without modifiers. */
  readonly instanceId: string;
  /** `public`, `friends+`, `friends`, `hidden`, `private`, `invite_plus`, `group-public`, `group-plus`, `group-members`. */
  readonly instanceType: string;
  /** From `~group(grp_…)`; `''` for non-group instances. */
  readonly groupId: string;
  readonly region: string;
  readonly userCount: number;
  readonly capacity: number;
  readonly users: readonly VrcInstanceUser[];
}

/** An instance one of your friends is in. */
export interface VrcFriendInstance {
  readonly location: string;
  readonly worldId: string;
  readonly worldName: string;
  readonly instanceType: string;
  readonly friends: readonly VrcUserSummary[];
}

/**
 * One of VRCNext's timeline records about a user.
 *
 * The four fields at the top are on every record; the rest depend on `type` and are absent
 * when the record does not carry them. `formatUserEvent` reads all of them, so a plugin does
 * not have to know which type carries what.
 */
export interface VrcTimelineEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly location: string;
  readonly worldName: string;
  /** VRCNext's own id for the record, stable across reads. */
  readonly id?: string;
  readonly worldId?: string;
  /** The user the record is about, for the types that name one. */
  readonly userId?: string;
  readonly userName?: string;
  /** The finer type: a moderation action (`block`, `mute`) or a VRChat notification type. */
  readonly notifType?: string;
  readonly notifTitle?: string;
  readonly senderId?: string;
  readonly senderName?: string;
  /** Free text, and for `moderation` the `on`/`off` flag saying whether the action was undone. */
  readonly message?: string;
  /** When an `instance_join` ended; `''` while it is still going. */
  readonly leftAt?: string;
}

export interface VrcSearchPage<T> {
  readonly results: readonly T[];
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface VrcSearchOptions {
  readonly offset?: number;
  readonly signal?: AbortSignal;
}

export interface VrcLookupOptions {
  /** Answer from the host's cache when it has the thing, without asking VRCNext again. */
  readonly cached?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * Read-only VRChat data through VRCNext. Every method needs the `vrchat` permission and asks
 * the user once per plugin.
 */
export interface VrchatApi {
  /** The signed-in account, or `undefined` before login. Synchronous: VRCNext pushes it. */
  self(): VrcSelf | undefined;

  /** Your friend list, from VRCNext's live store. */
  friends(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]>;
  /** Your favourite friends. */
  favoriteFriends(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]>;
  /** The same, kept in their groups, with the names you gave the groups. */
  favoriteFriendGroups(options?: VrcLookupOptions): Promise<readonly VrcFavoriteGroup[]>;
  /** How many people you have blocked, muted and so on. */
  moderationCounts(options?: VrcLookupOptions): Promise<VrcModerationCounts>;
  /** Players VRCNext recorded near you, most recent first. */
  recentPlayers(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]>;

  favoriteWorlds(options?: VrcLookupOptions): Promise<readonly VrcWorldSummary[]>;
  /** Worlds you visited, most recent first. */
  recentWorlds(options?: VrcLookupOptions): Promise<readonly VrcWorldSummary[]>;

  /** Avatars you uploaded. */
  ownAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]>;
  favoriteAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]>;
  /** Avatars you wore, most recent first. */
  recentAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]>;

  /** Groups you are a member of. */
  myGroups(options?: VrcLookupOptions): Promise<readonly VrcGroupSummary[]>;

  /** The instance you are in, or `undefined` when VRChat is not running or you are nowhere. */
  currentInstance(options?: VrcLookupOptions): Promise<VrcInstance | undefined>;
  /** Instances your friends are in right now, grouped by location. */
  friendInstances(options?: VrcLookupOptions): Promise<readonly VrcFriendInstance[]>;

  /** A full profile. VRCNext answers from its own cache first, then from the API. */
  user(id: string, options?: VrcLookupOptions): Promise<VrcUser | undefined>;
  /** Name, picture and status only — the cheapest lookup, never an API call for a friend. */
  userBasic(id: string, options?: VrcLookupOptions): Promise<VrcUserSummary | undefined>;
  /** The groups a user shows publicly. */
  userGroups(id: string, options?: VrcLookupOptions): Promise<readonly VrcGroupSummary[]>;
  /** VRCNext's ten most recent timeline records involving the user. */
  userTimeline(id: string, options?: VrcLookupOptions): Promise<readonly VrcTimelineEvent[]>;
  /** The avatar a player in your instance wears, resolved through VRCNext's avatar databases. */
  instanceAvatar(userId: string, options?: VrcLookupOptions): Promise<{ readonly avatarId: string; readonly avatarName: string } | undefined>;

  avatar(id: string, options?: VrcLookupOptions): Promise<VrcAvatar | undefined>;
  world(id: string, options?: VrcLookupOptions): Promise<VrcWorld | undefined>;
  group(id: string, options?: VrcLookupOptions): Promise<VrcGroup | undefined>;

  /** VRChat's user search, by display name. Twenty per page. */
  searchUsers(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcUserSummary>>;
  searchWorlds(query: string, options?: VrcSearchOptions & { readonly sort?: string }): Promise<VrcSearchPage<VrcWorldSummary>>;
  searchGroups(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcGroupSummary>>;
  /** The avatar databases VRCNext searches (avtrDB and friends), by name. */
  searchAvatars(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcAvatarSummary>>;
}
