/**
 * Plugin repository source URLs.
 *
 * The user pastes a repo URL into the UI. Everything downstream joins paths onto it and
 * executes what comes back, so parsing is strict: only known forge hosts over HTTPS, and only
 * shapes that resolve to a raw-content base we control the construction of.
 */

import { makeRepoId, type RepoId } from '@vrcnext/plugin-api';

export const FORGES = {
  github: 'github',
  gitea: 'gitea',
} as const;

export type Forge = (typeof FORGES)[keyof typeof FORGES];

export interface RepoSource {
  readonly id: RepoId;
  readonly forge: Forge;
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  /** Origin used to build raw-content URLs. */
  readonly rawBase: URL;
  /** Human-facing page for the repository. */
  readonly homepage: URL;
}

const DEFAULT_REF = 'main';
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 100 && SEGMENT_PATTERN.test(value) && value !== '..';
}

/** A git ref may contain slashes (`release/2026`), but never a traversal segment. */
function isSafeRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    value.split('/').every((segment) => isSafeSegment(segment))
  );
}

export interface RepoParseResult {
  readonly source: RepoSource | undefined;
  readonly error: string | undefined;
}

function fail(error: string): RepoParseResult {
  return { source: undefined, error };
}

/**
 * Parses a user-supplied repository URL.
 *
 * Accepts `owner/repo` shorthand (assumed GitHub), a GitHub URL with an optional
 * `/tree/<ref>` suffix, and a self-hosted Gitea URL of the form `https://host/owner/repo`.
 */
export function parseRepoSource(input: string, defaultRef = DEFAULT_REF): RepoParseResult {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (trimmed.length === 0) return fail('Enter a repository URL.');

  const shorthand = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed);
  if (shorthand !== null) {
    const [, owner = '', repo = ''] = shorthand;
    return buildGithub(owner, repo, defaultRef);
  }

  // `new URL()` resolves `..` away, so `github.com/../etc/passwd` would silently normalise into
  // the unrelated repo `etc/passwd`. Reject traversal on the raw input, before parsing.
  if (/(^|\/)\.\.?(\/|$)/.test(trimmed)) {
    return fail('The repository URL must not contain "." or ".." path segments.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('That is not a valid URL. Use "owner/repo" or a full https:// URL.');
  }

  if (url.protocol !== 'https:') return fail('Only https:// repository URLs are supported.');

  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  const [owner, repo, ...rest] = segments;
  if (owner === undefined || repo === undefined) {
    return fail('The URL must include an owner and a repository name.');
  }
  if (!isSafeSegment(owner) || !isSafeSegment(repo)) {
    return fail('The owner or repository name contains unsupported characters.');
  }

  let ref = defaultRef;
  if (rest.length > 0) {
    if (rest[0] !== 'tree' || rest.length < 2) {
      return fail('Only a plain repository URL or a /tree/<branch> URL is supported.');
    }
    ref = rest.slice(1).join('/');
  }
  if (!isSafeRef(ref)) return fail('The branch or tag name contains unsupported characters.');

  return GITHUB_HOSTS.has(url.hostname)
    ? buildGithub(owner, repo, ref)
    : buildGitea(url.origin, owner, repo, ref);
}

function buildGithub(owner: string, repo: string, ref: string): RepoParseResult {
  if (!isSafeSegment(owner) || !isSafeSegment(repo)) {
    return fail('The owner or repository name contains unsupported characters.');
  }
  if (!isSafeRef(ref)) return fail('The branch or tag name contains unsupported characters.');
  return {
    source: {
      id: makeRepoId(owner, repo, ref),
      forge: FORGES.github,
      owner,
      repo,
      ref,
      rawBase: new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`),
      homepage: new URL(`https://github.com/${owner}/${repo}`),
    },
    error: undefined,
  };
}

function buildGitea(origin: string, owner: string, repo: string, ref: string): RepoParseResult {
  if (!isSafeRef(ref)) return fail('The branch or tag name contains unsupported characters.');
  return {
    source: {
      id: makeRepoId(owner, repo, ref),
      forge: FORGES.gitea,
      owner,
      repo,
      ref,
      rawBase: new URL(`${origin}/${owner}/${repo}/raw/branch/${ref}/`),
      homepage: new URL(`${origin}/${owner}/${repo}`),
    },
    error: undefined,
  };
}

/** Resolves a manifest-relative path against the repo's raw-content base. */
export function rawUrlFor(source: RepoSource, relativePath: string): URL {
  return new URL(relativePath, source.rawBase);
}
