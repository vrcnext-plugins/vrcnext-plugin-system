#!/usr/bin/env bash
# Installs the repository's own dev bundle into VRCNext as a custom theme.
#
# For development only: it copies dist/vrcnext-plugin-host.js (host + the two example plugins)
# into the theme folder the VRCNext Bridge would otherwise write. Users run install/install.sh
# instead. The theme folder lives in VRCNext's config directory, not its install directory, so a
# VRCNext update does not remove it. Nothing in the VRCNext repository or install tree is modified.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEME_NAME="vrcnext-plugin-system"
BUNDLE="$ROOT/dist/vrcnext-plugin-host.js"

config_root() {
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf '%s/VRCNext' "$XDG_CONFIG_HOME"
  else
    printf '%s/.config/VRCNext' "$HOME"
  fi
}

VRCN_CONFIG="$(config_root)"
THEME_DIR="$VRCN_CONFIG/custom-themes/$THEME_NAME"
SETTINGS="$VRCN_CONFIG/settings.json"

PIN_PORT="${VRCNEXT_PIN_PORT:-}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --pin-port=*) PIN_PORT="${arg#*=}" ;;
    -h|--help)
      cat <<'USAGE'
Usage: install-into-vrcnext.sh [--dry-run] [--pin-port=PORT]

  --dry-run        Show what would change without writing anything.
  --pin-port=PORT  Pin VRCNext's LocalHttpPort (see below). Requires jq.

Why pin the port: the bridge endpoint and pairing token live in the page's localStorage, which
is scoped to the origin http://localhost:<LocalHttpPort>. VRCNext picks a new random port
whenever its saved one is taken, and a new port is a new origin, so the token would have to be
pasted again. Pinning a port VRCNext can reliably bind keeps it put.
USAGE
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$BUNDLE" ]]; then
  echo "Bundle not found at $BUNDLE — run ./scripts/build.sh first." >&2
  exit 1
fi

if [[ ! -d "$VRCN_CONFIG" ]]; then
  echo "VRCNext config directory not found at $VRCN_CONFIG." >&2
  echo "Start VRCNext at least once before installing." >&2
  exit 1
fi

if pgrep -x VRCNext >/dev/null 2>&1; then
  echo "VRCNext is running. Close it first — it rewrites settings.json on exit and would" >&2
  echo "overwrite any change made here." >&2
  exit 1
fi

echo "==> Target: $THEME_DIR"
if (( DRY_RUN )); then
  echo "    would copy $(basename "$BUNDLE") and info.json"
  [[ -n "$PIN_PORT" ]] && echo "    would set LocalHttpPort=$PIN_PORT in $SETTINGS"
  echo "    would add \"$THEME_NAME\" to ActiveCustomThemes"
  exit 0
fi

mkdir -p "$THEME_DIR"
cp "$BUNDLE" "$THEME_DIR/"
[[ -f "$BUNDLE.map" ]] && cp "$BUNDLE.map" "$THEME_DIR/"

VERSION="$(node -p "require('$ROOT/packages/api/package.json').version")"
cat > "$THEME_DIR/info.json" <<JSON
{
  "author": "vrcnext-plugins",
  "version": "$VERSION"
}
JSON

if ! command -v jq >/dev/null 2>&1; then
  echo "==> jq not found; skipping settings.json changes."
  echo "    Enable the theme manually: Settings -> Design -> Themes -> $THEME_NAME"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
echo "==> Backed up settings.json"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [[ -n "$PIN_PORT" ]]; then
  jq --argjson port "$PIN_PORT" --arg theme "$THEME_NAME" \
    '.LocalHttpPort = $port | .ActiveCustomThemes = ((.ActiveCustomThemes // []) + [$theme] | unique)' \
    "$SETTINGS" > "$TMP"
  echo "==> Pinned LocalHttpPort to $PIN_PORT"
else
  jq --arg theme "$THEME_NAME" \
    '.ActiveCustomThemes = ((.ActiveCustomThemes // []) + [$theme] | unique)' \
    "$SETTINGS" > "$TMP"
fi

mv "$TMP" "$SETTINGS"
trap - EXIT

echo "==> Enabled \"$THEME_NAME\". Start VRCNext; a Plugins entry appears in the sidebar."
