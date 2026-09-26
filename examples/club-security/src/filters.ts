/**
 * Decides whether the current instance is one the user wants reports for.
 */

import type { SettingsValues } from '@vrcnext/plugin-api';

import type { CurrentInstance } from './vrcnext-data.js';
import type { Settings } from './settings.js';

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

export function instanceMatches(filter: InstanceFilter, instance: CurrentInstance): boolean {
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
