/**
 * A prefilled bug report for the plugin's own repository.
 *
 * When a plugin fails to load, the useful next step is almost always telling its author — and
 * the report they need is the one nobody types: which host, which plugin version, which API
 * range, and the actual error. So the host writes it, and the user presses one button.
 *
 * Only GitHub is recognised. A link builder that guessed at every forge's query parameters
 * would produce URLs that open the wrong page, which is worse than offering no link at all.
 */

import type { PluginManifest } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';

/** GitHub truncates a very long prefilled body; this keeps the link inside what it accepts. */
const MAX_DETAIL = 1200;

/** `https://github.com/<owner>/<repo>`, or `undefined` for anything else. */
function githubRepo(homepage: string | undefined): string | undefined {
  if (homepage === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(homepage);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined;
  const [owner, repo] = url.pathname.split('/').filter((part) => part !== '');
  if (owner === undefined || repo === undefined) return undefined;
  return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
}

/** What went wrong, trimmed to something a URL can carry. */
function detail(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL)}\n… truncated`;
}

export interface IssueReport {
  /** The link to open, prefilled. */
  readonly url: string;
  /** Shown on the button. */
  readonly label: string;
}

/**
 * A link that opens a new issue on the plugin's repository, prefilled.
 *
 * `undefined` when the manifest names no GitHub homepage, in which case the caller says what
 * went wrong without offering a link it cannot build.
 */
export function issueReport(manifest: PluginManifest, error: unknown): IssueReport | undefined {
  const repo = githubRepo(manifest.homepage);
  if (repo === undefined) return undefined;
  const title = `${manifest.name} ${manifest.version} does not load on plugin API ${API_VERSION}`;
  const body = [
    `**Plugin:** ${manifest.name} ${manifest.version} (\`${manifest.id}\`)`,
    `**Declared API range:** \`${manifest.apiVersion}\``,
    `**Host API version:** \`${API_VERSION}\``,
    '',
    'The VRCNext plugin host loaded this plugin anyway and it failed:',
    '',
    '```',
    detail(error),
    '```',
    '',
    '_Reported from the VRCNext plugin host._',
  ].join('\n');
  const query = new URLSearchParams({ title, body });
  return { url: `${repo}/issues/new?${query.toString()}`, label: 'Report to the author' };
}
