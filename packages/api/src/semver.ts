/**
 * The slice of semver this project needs, in forty lines.
 *
 * The api package is compiled straight from source by the bridge, with no `node_modules`, so it
 * cannot depend on an npm package. Versions are plain `MAJOR.MINOR.PATCH` (no prerelease, no
 * build metadata — the bridge's manifest validator refuses anything else) and ranges are the
 * shapes plugin authors actually write: exact, `^`, `~`, and comparator lists such as
 * `>=0.2.0 <0.4.0`. Anything else is not a range this project accepts.
 */

export type Version = readonly [major: number, minor: number, patch: number];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Parse `MAJOR.MINOR.PATCH`, or `undefined` for anything else. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersion(text: string): boolean {
  return parseVersion(text) !== undefined;
}

export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

type Comparator = (version: Version) => boolean;

function bounded(low: Version, high: Version): Comparator {
  return (version) => compareVersions(version, low) >= 0 && compareVersions(version, high) < 0;
}

/** `^1.2.3` → `>=1.2.3 <2.0.0`; for `0.x` the minor is the breaking digit, as npm defines it. */
function caret([major, minor, patch]: Version): Comparator {
  if (major > 0) return bounded([major, minor, patch], [major + 1, 0, 0]);
  if (minor > 0) return bounded([0, minor, patch], [0, minor + 1, 0]);
  return bounded([0, 0, patch], [0, 0, patch + 1]);
}

function tilde([major, minor, patch]: Version): Comparator {
  return bounded([major, minor, patch], [major, minor + 1, 0]);
}

const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?(.+)$/;

function parseComparator(text: string): Comparator | undefined {
  const match = COMPARATOR.exec(text);
  if (match === null) return undefined;
  const version = parseVersion(match[2] ?? '');
  if (version === undefined) return undefined;
  switch (match[1] ?? '=') {
    case '^': return caret(version);
    case '~': return tilde(version);
    case '>=': return (candidate) => compareVersions(candidate, version) >= 0;
    case '<=': return (candidate) => compareVersions(candidate, version) <= 0;
    case '>': return (candidate) => compareVersions(candidate, version) > 0;
    case '<': return (candidate) => compareVersions(candidate, version) < 0;
    default: return (candidate) => compareVersions(candidate, version) === 0;
  }
}

/** Parse a range, or `undefined` if any part of it is not a shape this project accepts. */
export function parseRange(text: string): Comparator | undefined {
  const parts = text.trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return undefined;
  const comparators: Comparator[] = [];
  for (const part of parts) {
    const comparator = parseComparator(part);
    if (comparator === undefined) return undefined;
    comparators.push(comparator);
  }
  return (version) => comparators.every((comparator) => comparator(version));
}

export function isRange(text: string): boolean {
  return parseRange(text) !== undefined;
}

/** Whether `version` is inside `range`. A malformed version or range never satisfies. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const matcher = parseRange(range);
  return parsed !== undefined && matcher?.(parsed) === true;
}
