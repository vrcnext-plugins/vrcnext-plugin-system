#!/usr/bin/env bash
# Needs a bridge started with --dev: the rebuild is POSTed so the page is told about it and
# shows "Rebuilt — reload to apply". Without --dev the same build is `vrcnext-bridge
# --build-plugins`, which writes the same bundle but tells nobody.
# Deploys this working tree's host sources to the local bridge and rebuilds the bundle.
#
# The bridge compiles the host from ~/.vrcnext-plugins/host/packages/*/src with its own pinned
# esbuild, so deploying is a source copy plus one POST. Tests never ship: they are not bundled,
# and the source policy counts every file it can see.
#
# This does NOT reload VRCNext's page. Reloading re-authenticates against the VRChat API, so the
# last step is the owner's: `vrcnext-eval 'location.reload()'`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_DIR="${VRCNEXT_PLUGINS_HOME:-$HOME/.vrcnext-plugins}"
TOKEN_FILE="$HOST_DIR/token"
PORT="${VRCNEXT_BRIDGE_PORT:-}"

[[ -d "$HOST_DIR/host/packages" ]] || { echo "No host install at $HOST_DIR/host/packages." >&2; exit 1; }
[[ -r "$TOKEN_FILE" ]] || { echo "No pairing token at $TOKEN_FILE." >&2; exit 1; }

# The bridge binds an ephemeral port and logs it; the unit's journal is the only record.
if [[ -z "$PORT" ]]; then
  PORT="$(journalctl --user -u vrcnext-bridge.service -o cat \
    | sed -n 's|.*listening on http://127\.0\.0\.1:\([0-9]\+\).*|\1|p' | tail -1)"
fi
[[ -n "$PORT" ]] || { echo "Could not find the bridge's port; pass VRCNEXT_BRIDGE_PORT." >&2; exit 1; }

echo "==> Gate"
"$ROOT/scripts/check.sh" >/dev/null

echo "==> Copying packages/*/src to $HOST_DIR/host (without tests)"
for package in "$ROOT"/packages/*/; do
  name="$(basename "$package")"
  [[ -d "$package/src" ]] || continue
  target="$HOST_DIR/host/packages/$name/src"
  [[ -d "$target" ]] || { echo "  skipping $name: not installed"; continue; }
  rm -rf "$target"
  mkdir -p "$target"
  # `cp` is aliased to `cp -i` in the owner's shell; the absolute path cannot prompt.
  (cd "$package/src" && /usr/bin/find . -type f ! -name '*.test.ts' ! -name '*.test.tsx' -print0 \
    | while IFS= read -r -d '' file; do
        mkdir -p "$target/$(dirname "$file")"
        /usr/bin/cp -f "$file" "$target/$file"
      done)
  # The manifest travels with the sources. It is not built from, but it is what anyone
  # inspecting the installed host reads to learn which API version is deployed, and leaving the
  # original behind made it claim 0.3.6 while 0.8.0 was running.
  if [[ -f "$package/package.json" ]]; then
    /usr/bin/cp -f "$package/package.json" "$HOST_DIR/host/packages/$name/package.json"
  fi
  echo "  $name: $(/usr/bin/find "$target" -type f | wc -l) file(s)"
done

echo "==> Rebuilding the bundle"
response="$(mktemp)"
trap 'rm -f "$response"' EXIT
code="$(curl -s -o "$response" -w '%{http_code}' -X POST \
  "http://127.0.0.1:$PORT/v1/plugins/build" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -H "Content-Type: application/json" -d "{}")"
cat "$response"
echo
[[ "$code" == "200" ]] || { echo "Build refused (HTTP $code)." >&2; exit 1; }

echo
echo "Deployed. Reload the page yourself when you are ready:"
echo "  vrcnext-eval 'location.reload()'"
