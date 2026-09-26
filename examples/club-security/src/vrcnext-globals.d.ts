/**
 * Globals VRCNext's classic scripts declare with top-level `let`. Those are global lexical
 * bindings: not properties of `globalThis`, but reachable by bare identifier from any script or
 * module in the page. `typeof` guards against the binding not existing in another version.
 */

/** Set by `renderVrcProfile` in `core.js` once the account has logged in; `null` before. */
declare const currentVrcUser: { readonly id?: unknown; readonly displayName?: unknown } | null | undefined;
