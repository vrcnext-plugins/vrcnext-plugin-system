/**
 * Version of `@vrcnext/plugin-api` this host implements.
 *
 * A plugin's manifest declares the range it was built against; the loader refuses to activate a
 * plugin whose range this version does not satisfy. Kept in its own module so the build can
 * assert it against `packages/api/package.json` rather than trusting a hand-edited copy.
 */
export const API_VERSION = '0.1.0';
