#!/usr/bin/env bash
# Copy examples/example-plugin into the flat vrcnext-example-plugin repository.
#
# The canonical copy lives here, where the repo's own gate type-checks it against the live
# `packages/api` and bundles it into the host. The flat repository is its published form: what
# users clone, what GitHub offers as a template, and the thing the bridge actually installs.
#
# Only the plugin's own sources move. The flat repo keeps its own package.json, tsconfig,
# LICENSE, scripts/ and .github/ — they describe a standalone repository, not a workspace
# member — and its plugin.sig, which has to be remade after this runs:
#
#   node scripts/sign-plugin.mjs sign --key ~/.vrcnext-plugins/signing-key.txt
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/examples/example-plugin"
DEST="${1:-$ROOT/../vrcnext-example-plugin}"

[[ -d "$DEST/.git" ]] || { echo "not a checkout: $DEST" >&2; exit 1; }

rsync -a --delete "$SRC/src/" "$DEST/src/"
for file in main.ts plugin.json README.md eslint.config.mjs .gitignore; do
  cp "$SRC/$file" "$DEST/$file"
done

echo "Synced into $DEST. Re-sign before committing:"
echo "  (cd $DEST && node scripts/sign-plugin.mjs sign --key ~/.vrcnext-plugins/signing-key.txt)"
