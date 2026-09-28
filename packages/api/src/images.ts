/**
 * Image URLs that survive leaving this machine.
 *
 * VRCNext serves most pictures from its own cache — `http://localhost:<port>/imgcache/Users/usr_…`
 * — which is perfect inside the app and useless anywhere else. A URL like that in a Discord embed
 * or a webhook is not an error anyone sees: Discord fetches it from its own servers, gets nothing,
 * and silently renders a field with no picture.
 *
 * So a URL that leaves is checked rather than trusted, and the ones VRChat serves itself
 * (`api.vrchat.cloud`) are the ones that work.
 */

/** Hosts that only mean something on the machine VRCNext runs on. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  return a === 127 || a === 10 || a === 0
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Whether `url` is an image address something off this machine could actually load.
 *
 * `http(s)` and a host that is not this machine or its network. Anything else — a cache URL, a
 * `data:` blob, a relative path, nonsense — is not.
 */
export function isPublicImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return !isLocalHost(parsed.hostname);
}

/**
 * `url` if it would load elsewhere, `''` if it would not.
 *
 * Empty rather than thrown: a report says what it can, and a template whose picture is not
 * shareable should drop that field instead of pointing the reader's Discord at someone's laptop.
 */
export function publicImageUrl(url: string | undefined): string {
  return url !== undefined && isPublicImageUrl(url) ? url : '';
}
