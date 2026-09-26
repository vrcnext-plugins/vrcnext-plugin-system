#!/usr/bin/env bash
# Type-checks every package, then bundles the host the way the VRCNext Bridge does.
#
# In an installation the bridge runs esbuild itself (vrcnext-bridge, crate `plugins`, module
# `build`) with exactly these flags, aliasing `@vrcnext/static-plugins` to the import table it
# generates from the installed clones. Here the alias points at the repo's own table,
# packages/host/static-plugins.dev.ts, which lists the examples. Keep the flag list below
# and the one in the bridge identical: a bundle that builds here but not there is the failure
# this script exists to catch early.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
BUNDLE="$OUT_DIR/vrcnext-plugin-host.js"

echo "==> Type-checking and emitting declarations"
npx tsc --build tsconfig.build.json

echo "==> Bundling host + example plugins (IIFE — VRCNext injects theme scripts as classic <script>)"
mkdir -p "$OUT_DIR"
npx esbuild packages/host/src/index.ts \
  --bundle \
  --format=iife \
  --target=es2022 \
  --tsconfig-raw='{"compilerOptions":{"target":"es2022","useDefineForClassFields":true}}' \
  --platform=browser \
  --minify \
  --sourcemap=linked \
  --alias:@vrcnext/plugin-api=./packages/api/src/index.ts \
  --alias:@vrcnext/static-plugins=./packages/host/static-plugins.dev.ts \
  --outfile="$BUNDLE" \
  --log-level=warning \
  --color=false

printf '==> Built %s (%s bytes)\n' "$BUNDLE" "$(stat -c%s "$BUNDLE")"
