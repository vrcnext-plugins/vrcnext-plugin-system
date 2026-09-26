/**
 * Settings schema. The host renders these as rows on the plugin's settings card and persists
 * them; the plugin reads them through `ctx.settings`.
 */

import type { SettingsSchema } from '@vrcnext/plugin-api';

/** Instance types as VRCNext's `ParseLocation` names them, plus a shorthand for every group type. */
export const INSTANCE_TYPES = [
  'public',
  'friends+',
  'friends',
  'hidden',
  'private',
  'invite_plus',
  'group',
  'group-public',
  'group-plus',
  'group-members',
] as const;

export const settings = {
  enabled: {
    kind: 'boolean',
    label: 'Report joins',
    description: 'Master switch. Filters below decide which instances count.',
    default: true,
  },
  instanceTypes: {
    kind: 'string',
    label: 'Only in these instance types',
    description:
      'Comma-separated. Leave empty for every instance. Types: public, friends+, friends, hidden, ' +
      'private, invite_plus, group-public, group-plus, group-members, or just "group" for all group instances.',
    default: '',
    placeholder: 'group-public, group-plus',
  },
  groupId: {
    kind: 'string',
    label: 'Only in instances of this group',
    description: 'A grp_… id. Leave empty for any group. When set, the report also says whether the joiner is a member.',
    default: '',
    placeholder: 'grp_00000000-0000-0000-0000-000000000000',
  },
  worldIds: {
    kind: 'string',
    label: 'Only in these worlds',
    description: 'Comma-separated wrld_… ids. Leave empty for any world.',
    default: '',
    placeholder: 'wrld_…, wrld_…',
  },
  settleSecs: {
    kind: 'number',
    label: 'Seconds to ignore after you join',
    description:
      'When you enter an instance, VRChat logs a join for everyone already there. Joins inside this window are remembered but not reported.',
    default: 15,
    min: 3,
    max: 120,
    step: 1,
  },
  collectTimeoutSecs: {
    kind: 'number',
    label: 'Seconds to wait for details',
    description: 'How long to wait for VRCNext to load the profile and avatar before reporting what is known.',
    default: 25,
    min: 5,
    max: 120,
    step: 5,
  },
  notifyToast: {
    kind: 'boolean',
    label: 'In-app toast',
    default: true,
  },
  notifyDesktop: {
    kind: 'boolean',
    label: 'Desktop notification',
    description: 'Through the VRCNext Bridge on any platform, or VRCNext’s tray toast on Windows.',
    default: true,
  },
  notifyVr: {
    kind: 'boolean',
    label: 'VR overlay notification',
    description: 'Through the VRCNext Bridge’s VR target on any platform, or the SteamVR wrist overlay on Windows.',
    default: true,
  },
  notifyDiscord: {
    kind: 'boolean',
    label: 'Discord webhook',
    default: false,
  },
  discordWebhookUrl: {
    kind: 'string',
    label: 'Discord webhook URL',
    description: 'Server Settings → Integrations → Webhooks. Sent straight from this page; the URL is stored locally only.',
    default: '',
    placeholder: 'https://discord.com/api/webhooks/…',
  },
  memory: {
    kind: 'string',
    label: 'Join memory',
    description: 'Internal: who has joined a matching instance before.',
    default: '{}',
    hidden: true,
  },
} as const satisfies SettingsSchema;

export type Settings = typeof settings;
