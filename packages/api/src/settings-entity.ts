/**
 * Settings that hold VRChat things: a user, a world, an avatar, a group or an instance.
 *
 * The stored value is the id (`usr_…`, `wrld_…`, `avtr_…`, `grp_…`, or a full instance
 * location `wrld_…:12345~…`); with `multiple`, an array of ids in the order they were chosen.
 * The host renders a picker over what VRCNext already knows — friends, favourites, players it
 * has seen, your groups, the instance you are in — and, where the scope allows it, a search
 * box against the VRChat API. The plugin never sees the picker: it reads ids.
 *
 * `scopes` limits where the picker looks. Omit it for every scope the kind has.
 */

import type { SettingBase } from './settings.js';

/**
 * Where a user picker looks.
 *
 * - `friends`: your friend list.
 * - `favorites`: your favourite friends.
 * - `recent`: players VRCNext has recorded near you, most recent first.
 * - `instance`: players in the instance you are in right now.
 * - `search`: the VRChat user search, by display name.
 */
export type UserScope = 'friends' | 'favorites' | 'recent' | 'instance' | 'search';

/** `favorites`, `recent` (worlds you visited), `current` (the world you are in) and `search`. */
export type WorldScope = 'favorites' | 'recent' | 'current' | 'search';

/** `own` (avatars you uploaded), `favorites`, `recent` (ones you wore) and `search` (the avatar databases). */
export type AvatarScope = 'own' | 'favorites' | 'recent' | 'search';

/** `mine` (groups you are in) and `search`. */
export type GroupScope = 'mine' | 'search';

/**
 * `current` (the instance you are in), `friends` (instances your friends are in) and `manual`
 * (a text field for pasting a location).
 */
export type InstanceScope = 'current' | 'friends' | 'manual';

export type EntityKind = 'user' | 'world' | 'avatar' | 'group' | 'instance';

interface EntityBase extends SettingBase {
  /** Text under the picker when nothing is chosen. */
  readonly placeholder?: string;
}

/** One id, `''` for none. */
interface SingleEntity {
  readonly multiple?: false;
  readonly default: string;
}

/** Several at once; the value is an array of ids in the order they were chosen. */
interface MultipleEntity {
  readonly multiple: true;
  readonly default: readonly string[];
}

type Cardinality = SingleEntity | MultipleEntity;

export type UserSetting = EntityBase & Cardinality & {
  readonly kind: 'user';
  readonly scopes?: readonly UserScope[];
};

export type WorldSetting = EntityBase & Cardinality & {
  readonly kind: 'world';
  readonly scopes?: readonly WorldScope[];
};

export type AvatarSetting = EntityBase & Cardinality & {
  readonly kind: 'avatar';
  readonly scopes?: readonly AvatarScope[];
};

export type GroupSetting = EntityBase & Cardinality & {
  readonly kind: 'group';
  readonly scopes?: readonly GroupScope[];
};

export type InstanceSetting = EntityBase & Cardinality & {
  readonly kind: 'instance';
  readonly scopes?: readonly InstanceScope[];
};

export type EntitySetting = UserSetting | WorldSetting | AvatarSetting | GroupSetting | InstanceSetting;

/** Every scope a kind has, in the order the picker shows them. */
export const ENTITY_SCOPES = {
  user: ['friends', 'favorites', 'recent', 'instance', 'search'],
  world: ['favorites', 'recent', 'current', 'search'],
  avatar: ['own', 'favorites', 'recent', 'search'],
  group: ['mine', 'search'],
  instance: ['current', 'friends', 'manual'],
} as const satisfies Readonly<Record<EntityKind, readonly string[]>>;

/** The scopes a spec allows, in picker order, dropping names the kind does not have. */
export function entityScopes(spec: EntitySetting): readonly string[] {
  const all: readonly string[] = ENTITY_SCOPES[spec.kind];
  const wanted: readonly string[] | undefined = spec.scopes;
  if (wanted === undefined || wanted.length === 0) return all;
  return all.filter((scope) => wanted.includes(scope));
}

const ID_PREFIX: Readonly<Record<EntityKind, RegExp>> = {
  user: /^usr_[0-9a-zA-Z-]{8,}$|^[0-9a-zA-Z]{10}$/,
  world: /^wrld_[0-9a-f-]{36}$/i,
  avatar: /^avtr_[0-9a-f-]{36}$/i,
  group: /^grp_[0-9a-f-]{36}$/i,
  instance: /^wrld_[0-9a-f-]{36}:[^\s'"]+$/i,
};

/** Whether `id` looks like an id of `kind`. Legacy ten-character user ids are accepted. */
export function isEntityId(kind: EntityKind, id: string): boolean {
  return ID_PREFIX[kind].test(id.trim());
}

/** Ids only, trimmed, de-duplicated; `''` or `[]` when nothing valid is left. */
export function coerceEntity(spec: EntitySetting, value: unknown): string | readonly string[] | undefined {
  if (spec.multiple === true) {
    if (!Array.isArray(value)) return typeof value === 'string' && value === '' ? [] : undefined;
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (isEntityId(spec.kind, id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return id === '' || isEntityId(spec.kind, id) ? id : undefined;
}
