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

/**
 * A picture VRCNext caches, named by what it belongs to rather than by an address.
 *
 * The cache is keyed by entity, so a picture can be asked for without having been handed a URL
 * first — which is what lets the stored address be preferred over whatever the payload carried.
 */
export type ImageSubject =
  | { readonly kind: 'user'; readonly id: string; readonly variant?: 'avatar' | 'pfp' | 'banner' }
  | { readonly kind: 'avatar'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string; readonly variant?: 'icon' | 'banner' }
  | { readonly kind: 'world'; readonly id: string };

/** VRCNext's subdirectory per kind, which is the first half of every cache key. */
const SUBDIRS = { user: 'Users', avatar: 'Avatars', group: 'Groups', world: 'Worlds' } as const;

/**
 * The key VRCNext files `subject`'s picture under, or `undefined` for an id that is not one.
 *
 * A user's current avatar picture and a group's icon are the bare id; the decorations VRC+ adds are
 * the same id with a suffix, which is why they are variants of one subject rather than kinds of
 * their own.
 */
export function imageCacheKeyFor(subject: ImageSubject): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(subject.id)) return undefined;
  const suffix =
    subject.kind === 'user' && (subject.variant === 'pfp' || subject.variant === 'banner')
      ? `_${subject.variant}`
      : subject.kind === 'group' && subject.variant === 'banner'
        ? '_banner'
        : '';
  return `${SUBDIRS[subject.kind]}/${subject.id}${suffix}`;
}

/**
 * The key VRCNext filed a cached picture under, for a cache URL it handed the page.
 *
 * VRCNext's cache is keyed by `<subdir>/<entityId>` — `Avatars/avtr_…`, `Users/usr_…`, or a
 * suffixed user id such as `Users/usr_…_pfp` for a VRC+ profile picture. The address it serves that
 * file from is the same pair under `/imgcache/`, with a file extension and a version or thumbnail
 * parameter. So the key is recoverable from the URL exactly, which is what lets a cache address be
 * turned back into the public one VRChat serves.
 *
 * `undefined` for anything that is not one of VRCNext's cache addresses — a public URL needs no
 * translating, and nothing else is a picture this could resolve.
 *
 * @example
 * imageCacheKey('http://localhost:51956/imgcache/Users/usr_1.png?v=63926&thumb=96')
 * // 'Users/usr_1'
 */
export function imageCacheKey(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!isLocalHost(parsed.hostname)) return undefined;
  const path = parsed.pathname.replace(/^\/+/, '');
  if (!path.startsWith('imgcache/')) return undefined;
  // The extension is the cache's business, not the key's; everything before it is the pair.
  const key = path.slice('imgcache/'.length).replace(/\.[a-z0-9]+$/i, '');
  // `Subdir/entityId` and nothing else: a key with another slash in it is not one of these, and a
  // key that escaped its subdirectory is not something to go looking up.
  return /^[A-Za-z]+\/[A-Za-z0-9_-]+$/.test(key) ? key : undefined;
}
