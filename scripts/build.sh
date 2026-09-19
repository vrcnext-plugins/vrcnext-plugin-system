#!/usr/bin/env bash
# Builds the API and host packages, then bundles the host into the single ESM file the
# bootstrap theme loads.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
BUNDLE="$OUT_DIR/vrcnext-plugin-host.js"

echo "==> Type-checking and emitting declarations"
npx tsc --build tsconfig.build.json

echo "==> Bundling host (IIFE — VRCNext injects theme scripts as classic <script>)"
mkdir -p "$OUT_DIR"
npx esbuild packages/host/src/bootstrap.ts \
  --bundle \
  --format=iife \
  --target=es2023 \
  --platform=browser \
  --sourcemap \
  --legal-comments=inline \
  --outfile="$BUNDLE"

echo "==> Bundling example plugin"
npx esbuild examples/hello-world/src/index.ts \
  --bundle \
  --format=esm \
  --target=es2023 \
  --platform=browser \
  --outfile="examples/hello-world/dist/hello-world.js"

printf '==> Built %s (%s bytes)\n' "$BUNDLE" "$(stat -c%s "$BUNDLE")"
