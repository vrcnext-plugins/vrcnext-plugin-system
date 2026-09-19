/**
 * Fetches manifests and plugin code from a repository.
 *
 * Everything here crosses the trust boundary: responses are size-capped, redirects are refused,
 * and the fetched code is never executed by this module — it is only stored. Execution is the
 * loader's job, after the user has explicitly enabled the plugin.
 */

import { MANIFEST_FILENAME, parseRepoManifest, type RepoManifest } from '@vrcnext/plugin-api';

import { rawUrlFor, type RepoSource } from './repo-source.js';

/** Generous for a manifest, far below anything that would exhaust page memory. */
const MAX_MANIFEST_BYTES = 512 * 1024;
/** A plugin bundle above this is almost certainly not a plugin. */
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export class RepoFetchError extends Error {
  override readonly name = 'RepoFetchError';
  readonly url: string;

  constructor(url: URL, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.url = url.href;
  }
}

interface FetchTextOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

async function fetchText(url: URL, options: FetchTextOptions): Promise<string> {
  const controller = new AbortController();
  const onAbort = (): void => { controller.abort(options.signal?.reason); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new Error('Request timed out.'));
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // A redirect could leave the origin we validated, so refuse rather than follow it.
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'text/plain, application/json' },
    });

    if (!response.ok) {
      throw new RepoFetchError(url, `The server answered ${String(response.status)}.`);
    }

    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > options.maxBytes) {
      throw new RepoFetchError(url, 'The response is larger than the allowed size.');
    }

    const text = await response.text();
    if (text.length > options.maxBytes) {
      throw new RepoFetchError(url, 'The response is larger than the allowed size.');
    }
    return text;
  } catch (error) {
    if (error instanceof RepoFetchError) throw error;
    throw new RepoFetchError(url, 'Could not reach the repository.', { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export interface FetchedManifest {
  readonly manifest: RepoManifest;
  /** Non-fatal problems: entries that were skipped while the rest parsed fine. */
  readonly warnings: readonly string[];
}

export async function fetchRepoManifest(
  source: RepoSource,
  signal?: AbortSignal,
): Promise<FetchedManifest> {
  const url = rawUrlFor(source, MANIFEST_FILENAME);
  const text = await fetchText(url, {
    maxBytes: MAX_MANIFEST_BYTES,
    ...(signal !== undefined ? { signal } : {}),
  });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new RepoFetchError(url, `${MANIFEST_FILENAME} is not valid JSON.`, { cause: error });
  }

  const { manifest, errors } = parseRepoManifest(raw);
  if (manifest === undefined) {
    throw new RepoFetchError(url, errors.join(' ') || `${MANIFEST_FILENAME} is invalid.`);
  }
  return { manifest, warnings: errors };
}

/** Downloads a plugin bundle as text. The caller stores it; it is not evaluated here. */
export async function fetchPluginBundle(
  source: RepoSource,
  entry: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = rawUrlFor(source, entry);
  // rawUrlFor resolves against the repo base, but a manifest could still have smuggled a path
  // that escapes it; confirm the result stayed under the base before fetching.
  if (!url.href.startsWith(source.rawBase.href)) {
    throw new RepoFetchError(url, 'The plugin entry path escapes the repository.');
  }
  return await fetchText(url, {
    maxBytes: MAX_BUNDLE_BYTES,
    ...(signal !== undefined ? { signal } : {}),
  });
}
