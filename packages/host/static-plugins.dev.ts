/**
 * The plugin table for the repository's own build.
 *
 * In an installation the VRCNext Bridge generates this file (`build/static-plugins.ts`) from
 * the installed clones. Here it lists the example plugin so `npm run check` bundles a host that
 * actually runs plugins. The shape is the one the bridge generates.
 */

import exampleManifest from '../../examples/example-plugin/plugin.json';
import example from '../../examples/example-plugin/main.js';

export const COMPILED_PLUGINS = [{ manifest: exampleManifest, plugin: example }] as const;
