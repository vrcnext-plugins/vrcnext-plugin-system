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
  --minify \
  --sourcemap \
  --legal-comments=eof \
  --outfile="$BUNDLE"

echo "==> Bundling example plugins"
for example in hello-world kitchen-sink; do
  npx esbuild "examples/$example/src/index.ts" \
    --bundle \
    --format=esm \
    --target=es2023 \
    --platform=browser \
    --minify \
    --sourcemap \
    --outfile="examples/$example/dist/$example.js"
done

printf '==> Built %s (%s bytes)\n' "$BUNDLE" "$(stat -c%s "$BUNDLE")"
