/**
 * Theme entry point.
 *
 * VRCNext injects a theme's `.js` files as classic `<script>` elements, so this file is bundled
 * as an IIFE rather than ESM — a top-level `export` would be a syntax error in that context.
 * Plugin bundles are unaffected: the loader evaluates those as real modules via blob URLs.
 */

import { boot } from './index.js';

function start(): void {
  boot().catch((error: unknown) => {
    globalThis.console.error('[vrcnext-plugins] host failed to start', error);
  });
}

// VRCNext injects themes after its own frontend has initialised, but a user enabling the theme
// from settings can land either side of DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
