/**
 * VRChat instance locations, taken apart.
 *
 * A location is `wrld_<uuid>:<instance id>` followed by `~` modifiers that carry the access
 * type and its owner (`~friends(usr_…)`, `~group(grp_…)~groupAccessType(plus)`), the region and
 * more. VRCNext names the access types `public`, `friends+`, `friends`, `hidden`, `private`,
 * `invite_plus`, `group-public`, `group-plus` and `group-members`; this is a port of its
 * `ParseLocation`, so a plugin and the host agree with the app.
 */

export const INSTANCE_TYPES = [
  'public',
  'friends+',
  'friends',
  'hidden',
  'private',
  'invite_plus',
  'group-public',
  'group-plus',
  'group-members',
] as const;

export type InstanceType = (typeof INSTANCE_TYPES)[number];

export interface ParsedLocation {
  readonly worldId: string;
  /** The part after the colon, without modifiers. */
  readonly instanceId: string;
  /** `worldId:instanceId`, the part that identifies the instance across visits. */
  readonly key: string;
  /** `''` for a location that is not an instance (`offline`, `private`, `traveling`, `''`). */
  readonly instanceType: InstanceType | '';
  /** `grp_…` for group instances. */
  readonly groupId: string;
  /** `usr_…` for friends, friends+, hidden and private instances. */
  readonly ownerId: string;
  readonly region: string;
}

function modifier(instance: string, name: string): string {
  return new RegExp(`~${name}\\(([^)]*)\\)`).exec(instance)?.[1] ?? '';
}

function accessType(instance: string): InstanceType {
  if (instance.includes('~private(')) return instance.includes('~canRequestInvite') ? 'invite_plus' : 'private';
  if (instance.includes('~friends+(')) return 'friends+';
  if (instance.includes('~friends(')) return 'friends';
  if (instance.includes('~hidden(')) return 'hidden';
  if (instance.includes('~group(')) {
    const access = modifier(instance, 'groupAccessType');
    if (access === 'public') return 'group-public';
    if (access === 'plus') return 'group-plus';
    return 'group-members';
  }
  return 'public';
}

export function parseLocation(location: string): ParsedLocation {
  const colon = location.indexOf(':');
  const worldId = colon < 0 ? location : location.slice(0, colon);
  const instance = colon < 0 ? '' : location.slice(colon + 1);
  const instanceId = instance.split('~')[0] ?? '';
  const isInstance = worldId.startsWith('wrld_') && instanceId !== '';
  return {
    worldId: worldId.startsWith('wrld_') ? worldId : '',
    instanceId,
    key: isInstance ? `${worldId}:${instanceId}` : '',
    instanceType: isInstance ? accessType(instance) : '',
    groupId: modifier(instance, 'group'),
    ownerId: modifier(instance, 'friends') || modifier(instance, 'friends+') || modifier(instance, 'hidden') || modifier(instance, 'private'),
    region: modifier(instance, 'region'),
  };
}

/** Whether an instance type is one of the group kinds. */
export function isGroupInstance(type: string): boolean {
  return type.startsWith('group');
}

/**
 * What VRCNext calls each instance type on screen.
 *
 * A port of the label map inside its `getInstanceBadge`. `hidden` is the original Friends+ and
 * the app badges it as such, so this does too: a reader of one report is being told the access
 * level, not VRChat's release history. Two types therefore share a label, which only matters
 * where all nine are listed at once — see {@link instanceTypeOptionLabel}.
 */
export const INSTANCE_TYPE_LABELS: Readonly<Record<InstanceType, string>> = {
  'public': 'Public',
  'friends+': 'Friends+',
  'friends': 'Friends',
  'hidden': 'Friends+',
  'private': 'Invite',
  'invite_plus': 'Invite+',
  'group-public': 'Group Public',
  'group-plus': 'Group+',
  'group-members': 'Group Members',
};

/** {@link INSTANCE_TYPE_LABELS}, falling back to the raw type for anything unknown. */
export function instanceTypeLabel(type: string): string {
  const labels: Readonly<Record<string, string | undefined>> = INSTANCE_TYPE_LABELS;
  return labels[type] ?? type;
}

/**
 * The same label, made unambiguous for a list that offers every type at once.
 *
 * {@link INSTANCE_TYPE_LABELS} badges one instance, where sharing a label loses nothing. A
 * picker is the opposite: two options reading "Friends+" cannot be told apart, and the one the
 * user did not mean filters differently. The collisions are found in the map rather than listed
 * again here, so adding a type cannot leave this behind.
 */
export function instanceTypeOptionLabel(type: InstanceType): string {
  const label = INSTANCE_TYPE_LABELS[type];
  const shared = INSTANCE_TYPES.filter((other) => INSTANCE_TYPE_LABELS[other] === label);
  return shared.length > 1 ? `${label} (${type})` : label;
}
