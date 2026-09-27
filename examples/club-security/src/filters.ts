/**
 * Decides whether the current instance is one the user wants reports for.
 */

import type { SettingsValues } from '@vrcnext/plugin-api';

import { groupIdOf } from './vrcnext-data.js';
import type { Settings } from './settings.js';

/** The three things a filter looks at; both a live instance and a past location provide them. */
export interface InstanceShape {
  readonly worldId: string;
  readonly instanceType: string;
  readonly groupId: string;
}

/**
 * VRCNext's `ParseLocation`, ported: the instance type a location string encodes. Needed for
 * past locations from the timeline, which carry no parsed type.
 */
export function instanceTypeOf(location: string): string {
  const instance = location.split(':')[1] ?? '';
  if (instance.includes('~private(')) return instance.includes('~canRequestInvite') ? 'invite_plus' : 'private';
  if (instance.includes('~friends+(')) return 'friends+';
  if (instance.includes('~friends(')) return 'friends';
  if (instance.includes('~hidden(')) return 'hidden';
  if (instance.includes('~group(')) {
    const access = /groupAccessType\(([^)]+)\)/.exec(instance)?.[1] ?? '';
    if (access === 'public') return 'group-public';
    if (access === 'plus') return 'group-plus';
    if (access === 'members') return 'group-members';
    return 'group';
  }
  return 'public';
}

export function shapeOfLocation(location: string): InstanceShape {
  const worldId = location.split(':')[0] ?? '';
  return { worldId: worldId.startsWith('wrld_') ? worldId : '', instanceType: instanceTypeOf(location), groupId: groupIdOf(location) };
}

export interface InstanceFilter {
  readonly instanceTypes: readonly string[];
  readonly groupId: string;
  readonly worldIds: readonly string[];
}

export function splitList(value: string): readonly string[] {
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function filterFrom(values: SettingsValues<Settings>): InstanceFilter {
  return {
    instanceTypes: splitList(values.instanceTypes),
    groupId: values.groupId.trim().toLowerCase(),
    worldIds: splitList(values.worldIds),
  };
}

function typeMatches(wanted: readonly string[], actual: string): boolean {
  if (wanted.length === 0) return true;
  const type = actual.toLowerCase();
  return wanted.some((w) => w === type || (w === 'group' && type.startsWith('group')));
}

export function instanceMatches(filter: InstanceFilter, instance: InstanceShape): boolean {
  if (!typeMatches(filter.instanceTypes, instance.instanceType)) return false;
  const groupId = filter.groupId.toLowerCase();
  if (groupId !== '' && instance.groupId.toLowerCase() !== groupId) return false;
  const worldIds = filter.worldIds.map((w) => w.toLowerCase());
  if (worldIds.length > 0 && !worldIds.includes(instance.worldId.toLowerCase())) return false;
  return true;
}

/** One line for the status card: what the filter currently restricts to. */
export function describeFilter(filter: InstanceFilter): string {
  const parts: string[] = [];
  if (filter.instanceTypes.length > 0) parts.push(`types: ${filter.instanceTypes.join(', ')}`);
  if (filter.groupId !== '') parts.push(`group: ${filter.groupId}`);
  if (filter.worldIds.length > 0) parts.push(`worlds: ${String(filter.worldIds.length)}`);
  return parts.length === 0 ? 'every instance' : parts.join(' · ');
}
