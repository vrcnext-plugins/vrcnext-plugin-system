/**
 * `plugin.json` — the manifest at the root of every plugin repository.
 *
 * The bridge validates it when a plugin is installed or updated, and the host validates it again
 * when it reads the compiled plugin table at boot. Both use this parser, so a manifest that
 * passes one passes the other. Parsing never throws: a bad manifest yields a list of problems
 * the UI can show verbatim.
 */

import { parsePluginId, type PluginId } from './ids.js';
import { isPermission, type Permission } from './permissions.js';
import { isRange, isVersion } from './semver.js';

/** File name at the repository root. */
export const MANIFEST_FILENAME = 'plugin.json';

export const MANIFEST_LIMITS = {
  descriptionChars: 200,
  tags: 8,
} as const;

/** Suggested tags. Any string is accepted; these are the ones the manager filters by. */
export const PLUGIN_TAGS = [
  'accessibility',
  'activity',
  'audio',
  'chat',
  'customisation',
  'developer',
  'friends',
  'fun',
  'media',
  'notifications',
  'osc',
  'privacy',
  'ui',
  'utility',
] as const;

export type PluginTag = (typeof PLUGIN_TAGS)[number] | (string & {});

/**
 * What the manager needs to describe a plugin, whether it comes from the compiled bundle or from
 * the bridge's list of clones. Everything user-facing, nothing about the build.
 */
export interface PluginSummary {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly PluginTag[];
  /** Granted at enable time, or the plugin does not run. */
  readonly permissions: readonly Permission[];
  /** Requested lazily through `ctx.permissions.request`. */
  readonly optionalPermissions: readonly Permission[];
  /** Exact VRCNext action names `ctx.bridge` may send. Needs `host:actions`. */
  readonly actions: readonly string[];
  /** Exact host event names `ctx.events` may subscribe to. Needs `host:events`. */
  readonly events: readonly string[];
  /** Exact hosts `ctx.http.fetch` may reach. Needs `network`. No wildcards. */
  readonly hosts: readonly string[];
}

/** The full `plugin.json` shape. */
export interface PluginManifest extends PluginSummary {
  /** Semver range of `@vrcnext/plugin-api` this plugin was written against. */
  readonly apiVersion: string;
  readonly author?: string;
  readonly homepage?: string;
  /** Ids of plugins that must be running before this one activates. */
  readonly dependencies?: readonly PluginId[];
}

export interface ManifestParseResult {
  readonly manifest: PluginManifest | undefined;
  readonly errors: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** A list of distinct, non-empty strings. `undefined` means the field is absent. */
function stringList(field: string, value: unknown, errors: string[]): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`"${field}" must be an array of strings.`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    const text = asNonEmptyString(item);
    if (text === undefined) {
      errors.push(`"${field}" contains an empty or non-string entry.`);
      continue;
    }
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function permissionList(field: string, value: unknown, errors: string[]): readonly Permission[] {
  const out: Permission[] = [];
  for (const item of stringList(field, value, errors) ?? []) {
    if (isPermission(item)) out.push(item);
    else errors.push(`"${field}": unknown permission "${item}".`);
  }
  return out;
}

function dependencyList(value: unknown, errors: string[]): readonly PluginId[] | undefined {
  const raw = stringList('dependencies', value, errors);
  if (raw === undefined) return undefined;
  const out: PluginId[] = [];
  for (const item of raw) {
    const id = parsePluginId(item);
    if (id === undefined) errors.push(`"dependencies": malformed plugin id "${item}".`);
    else out.push(id);
  }
  return out;
}

/** A host as it appears in `hosts`: a bare host name, optionally with a port. No scheme, no path. */
function isHostName(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i.test(value);
}

interface RequiredFields {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly description: string;
}

function requiredFields(record: Record<string, unknown>, errors: string[]): RequiredFields | undefined {
  const rawId = asNonEmptyString(record['id']);
  const id = rawId === undefined ? undefined : parsePluginId(rawId);
  const name = asNonEmptyString(record['name']);
  const version = asNonEmptyString(record['version']);
  const apiVersion = asNonEmptyString(record['apiVersion']);
  const description = asNonEmptyString(record['description']) ?? '';

  if (id === undefined) errors.push('"id" is missing or not [a-z0-9][a-z0-9-]{1,39}.');
  if (name === undefined) errors.push('"name" is missing.');
  if (version === undefined) errors.push('"version" is missing.');
  else if (!isVersion(version)) errors.push(`"version" is not MAJOR.MINOR.PATCH: "${version}".`);
  if (apiVersion === undefined) errors.push('"apiVersion" is missing.');
  else if (!isRange(apiVersion)) errors.push(`"apiVersion" is not a version range: "${apiVersion}".`);
  if (description.length > MANIFEST_LIMITS.descriptionChars) {
    errors.push(`"description" is over ${String(MANIFEST_LIMITS.descriptionChars)} characters.`);
  }

  if (id === undefined || name === undefined || version === undefined || apiVersion === undefined) {
    return undefined;
  }
  return { id, name, version, apiVersion, description };
}

export function parsePluginManifest(raw: unknown): ManifestParseResult {
  const errors: string[] = [];
  const record = asRecord(raw);
  if (record === undefined) {
    return { manifest: undefined, errors: [`${MANIFEST_FILENAME} is not a JSON object.`] };
  }

  const required = requiredFields(record, errors);

  const tags = stringList('tags', record['tags'], errors) ?? [];
  if (tags.length > MANIFEST_LIMITS.tags) {
    errors.push(`"tags" lists more than ${String(MANIFEST_LIMITS.tags)} tags.`);
  }
  const permissions = permissionList('permissions', record['permissions'], errors);
  const optionalPermissions = permissionList(
    'optionalPermissions',
    record['optionalPermissions'],
    errors,
  );
  const actions = stringList('actions', record['actions'], errors) ?? [];
  const events = stringList('events', record['events'], errors) ?? [];
  const hosts = stringList('hosts', record['hosts'], errors) ?? [];
  for (const host of hosts) {
    if (!isHostName(host)) errors.push(`"hosts": "${host}" is not a bare host name.`);
  }
  const dependencies = dependencyList(record['dependencies'], errors);
  const author = asNonEmptyString(record['author']);
  const homepage = asNonEmptyString(record['homepage']);

  if (required === undefined || errors.length > 0) return { manifest: undefined, errors };

  return {
    manifest: {
      ...required,
      tags,
      permissions,
      optionalPermissions,
      actions,
      events,
      hosts,
      ...(author !== undefined ? { author } : {}),
      ...(homepage !== undefined ? { homepage } : {}),
      ...(dependencies !== undefined ? { dependencies } : {}),
    },
    errors,
  };
}
