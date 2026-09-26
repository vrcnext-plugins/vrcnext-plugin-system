/**
 * The plugin table for the repository's own build.
 *
 * In an installation the VRCNext Bridge generates this file (`build/static-plugins.ts`) from
 * the installed clones. Here it lists the examples so `npm run check` bundles a host that
 * actually runs plugins. The shape is the one the bridge generates.
 */

import helloManifest from '../../examples/hello-world/plugin.json';
import hello from '../../examples/hello-world/main.js';
import kitchenSinkManifest from '../../examples/kitchen-sink/plugin.json';
import kitchenSink from '../../examples/kitchen-sink/main.js';
import clubSecurityManifest from '../../examples/club-security/plugin.json';
import clubSecurity from '../../examples/club-security/main.js';

export const COMPILED_PLUGINS = [
  { manifest: helloManifest, plugin: hello },
  { manifest: kitchenSinkManifest, plugin: kitchenSink },
  { manifest: clubSecurityManifest, plugin: clubSecurity },
] as const;
