#!/usr/bin/env bash
# VRCNext plugin system installer (Linux, macOS).
#
# Installs the VRCNext Bridge daemon, a pinned esbuild binary and the plugin host sources into
# ~/.vrcnext-plugins, registers the bridge to start at login, starts it, builds the first bundle
# into VRCNext's custom-themes folder and prints the pairing token.
#
# Needs only curl and tar (plus sha256sum or shasum). Re-running is an upgrade: binaries and host
# sources are replaced, plugins/, state.json and token are kept, and the bundle is rebuilt.
#
#   curl -fsSL https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.sh | bash
#   bash install.sh [--pin-port=N] [--version=TAG] [--dry-run]
set -euo pipefail

# ---------------------------------------------------------------------------------------------
# Everything that names a release lives here.
# ---------------------------------------------------------------------------------------------
BRIDGE_REPO="vrcnext-plugins/vrcnext-bridge"
HOST_REPO="vrcnext-plugins/vrcnext-plugin-system"
HOST_ASSET="vrcnext-plugin-host-src.tar.gz"
SUMS_ASSET="SHA256SUMS"
# Bridge asset name is "vrcnext-bridge-<os>-<arch>" with os in {linux,macos} and arch in
# {x86_64,aarch64}; see bridge_asset_name below.

# esbuild is pinned by version AND by tarball digest, so a registry compromise cannot swap the
# binary the bridge will execute. Bump both together: `curl -s https://registry.npmjs.org/esbuild/latest`
# then sha256sum each https://registry.npmjs.org/@esbuild/<platform>/-/<platform>-<VER>.tgz.
ESBUILD_VERSION="0.28.2"
ESBUILD_REGISTRY="https://registry.npmjs.org"
esbuild_tarball_sha256() {
  case "$1" in
    linux-x64)    printf '9573bb2233aab0f9ea7647d5cca9726113cc1768de61d66b17267f4db84488f6' ;;
    linux-arm64)  printf 'a96dbfa41d3ef5dbd1ef22b1c10d5187be9267e86093a870f06402a7ec931596' ;;
    darwin-arm64) printf '1980cde09749094452b20d36ff267585ccb3f72749c7bc97291cd9996ccf5a2a' ;;
    darwin-x64)   printf 'abb6a7a895aaf2cc0df36fecc3bf0042479ffec51a643a056d54e9109f27db55' ;;
    *) return 1 ;;
  esac
}

BRIDGE_ADDR="127.0.0.1:42081"
THEME_NAME="vrcnext-plugin-system"
# Must match the bridge's own default (VRCNEXT_BRIDGE_DATA_DIR unset); it is not overridable here.
DATA_DIR="$HOME/.vrcnext-plugins"
SERVICE_NAME="vrcnext-bridge"
LAUNCHD_LABEL="io.github.vrcnext-plugins.bridge"

# ---------------------------------------------------------------------------------------------
# Output helpers. Colour only when stdout is a terminal.
# ---------------------------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'; C_GREEN=$'\e[32m'; C_RED=$'\e[31m'; C_CYAN=$'\e[36m'; C_RESET=$'\e[0m'
else
  C_BOLD=''; C_DIM=''; C_GREEN=''; C_RED=''; C_CYAN=''; C_RESET=''
fi
step() { printf '%s==>%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
note() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
die()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------
PIN_PORT="${VRCNEXT_PIN_PORT:-}"
BRIDGE_VERSION="latest"
HOST_VERSION="latest"
DRY_RUN=0
usage() {
  cat <<'USAGE'
Usage: install.sh [--pin-port=PORT] [--version=TAG] [--dry-run]

  --pin-port=PORT        Pin VRCNext's LocalHttpPort in settings.json (needs jq, VRCNext closed).
                         The pairing token is stored per page origin, and VRCNext picks a new
                         random port when its saved one is taken; pinning keeps the origin stable.
  --version=TAG          Release tag to install for BOTH vrcnext-bridge and vrcnext-plugin-system
                         (default: latest release of each).
  --bridge-version=TAG   Override the bridge tag only.
  --host-version=TAG     Override the plugin-system (host sources) tag only.
  --dry-run              Print what would be done without touching the network or the disk.
USAGE
}
for arg in "$@"; do
  case "$arg" in
    --dry-run)            DRY_RUN=1 ;;
    --pin-port=*)         PIN_PORT="${arg#*=}" ;;
    --version=*)          BRIDGE_VERSION="${arg#*=}"; HOST_VERSION="${arg#*=}" ;;
    --bridge-version=*)   BRIDGE_VERSION="${arg#*=}" ;;
    --host-version=*)     HOST_VERSION="${arg#*=}" ;;
    -h|--help)            usage; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done
if [[ -n "$PIN_PORT" ]] && ! [[ "$PIN_PORT" =~ ^[0-9]{1,5}$ && "$PIN_PORT" -ge 1024 && "$PIN_PORT" -le 65535 ]]; then
  die "--pin-port must be a number between 1024 and 65535, got '$PIN_PORT'"
fi

# ---------------------------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)  OS_TAG="linux";  ESBUILD_OS="linux" ;;
  Darwin) OS_TAG="macos";  ESBUILD_OS="darwin" ;;
  *) die "unsupported operating system: $OS (Linux and macOS only; use install.ps1 on Windows)" ;;
esac
case "$ARCH" in
  x86_64|amd64)  ARCH_TAG="x86_64";  ESBUILD_ARCH="x64" ;;
  aarch64|arm64) ARCH_TAG="aarch64"; ESBUILD_ARCH="arm64" ;;
  *) die "unsupported CPU architecture: $ARCH" ;;
esac
ESBUILD_PLATFORM="$ESBUILD_OS-$ESBUILD_ARCH"
BRIDGE_ASSET="vrcnext-bridge-$OS_TAG-$ARCH_TAG"
ESBUILD_SHA256="$(esbuild_tarball_sha256 "$ESBUILD_PLATFORM")" \
  || die "no pinned esbuild digest for $ESBUILD_PLATFORM"

release_url() { # repo tag asset
  if [[ "$2" == "latest" ]]; then
    printf 'https://github.com/%s/releases/latest/download/%s' "$1" "$3"
  else
    printf 'https://github.com/%s/releases/download/%s/%s' "$1" "$2" "$3"
  fi
}
ESBUILD_URL="$ESBUILD_REGISTRY/@esbuild/$ESBUILD_PLATFORM/-/$ESBUILD_PLATFORM-$ESBUILD_VERSION.tgz"

# VRCNext (a .NET app) resolves its config dir to ~/.config on both Linux and macOS.
if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  VRCN_CONFIG="$XDG_CONFIG_HOME/VRCNext"
else
  VRCN_CONFIG="$HOME/.config/VRCNext"
fi
THEME_DIR="$VRCN_CONFIG/custom-themes/$THEME_NAME"
SETTINGS="$VRCN_CONFIG/settings.json"
BIN_DIR="$DATA_DIR/bin"
BRIDGE_BIN="$BIN_DIR/vrcnext-bridge"
TOKEN_FILE="$DATA_DIR/token"

for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but not installed"
done
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "neither sha256sum nor shasum is available"
fi

# ---------------------------------------------------------------------------------------------
# Dry run: report the plan and stop before anything is fetched or written.
# ---------------------------------------------------------------------------------------------
if (( DRY_RUN )); then
  step "Dry run — nothing will be downloaded or written"
  note "platform:      $OS_TAG/$ARCH_TAG (esbuild $ESBUILD_PLATFORM)"
  note "data dir:      $DATA_DIR"
  note "theme dir:     $THEME_DIR"
  note "bridge:        $(release_url "$BRIDGE_REPO" "$BRIDGE_VERSION" "$BRIDGE_ASSET")"
  note "               verified against $(release_url "$BRIDGE_REPO" "$BRIDGE_VERSION" "$SUMS_ASSET")"
  note "host sources:  $(release_url "$HOST_REPO" "$HOST_VERSION" "$HOST_ASSET")"
  note "               verified against $(release_url "$HOST_REPO" "$HOST_VERSION" "$SUMS_ASSET")"
  note "esbuild:       $ESBUILD_URL"
  note "               verified against pinned sha256 $ESBUILD_SHA256"
  note "               -> $BIN_DIR/esbuild + $BIN_DIR/esbuild.sha256"
  if [[ "$OS_TAG" == linux ]]; then
    note "autostart:     ~/.config/systemd/user/$SERVICE_NAME.service (systemctl --user enable --now)"
  else
    note "autostart:     ~/Library/LaunchAgents/$LAUNCHD_LABEL.plist (launchctl bootstrap)"
  fi
  if [[ -n "$PIN_PORT" ]]; then
    note "settings:      set LocalHttpPort=$PIN_PORT and enable \"$THEME_NAME\" in $SETTINGS (jq)"
  else
    note "settings:      enable \"$THEME_NAME\" in $SETTINGS if jq is present and VRCNext is closed"
  fi
  note "then:          wait for http://$BRIDGE_ADDR/v1/health, POST /v1/plugins/build, print token"
  [[ -f "$TOKEN_FILE" ]] && note "existing install detected: plugins/, state.json and token are kept"
  exit 0
fi

# ---------------------------------------------------------------------------------------------
# Download + verify
# ---------------------------------------------------------------------------------------------
TMP="$(mktemp -d "${TMPDIR:-/tmp}/vrcnext-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fetch() { # url dest
  curl -fsSL --retry 3 --proto '=https' -o "$2" "$1" \
    || die "download failed: $1"
}
# Verifies file $2 (named $3 inside the sums file) against SHA256SUMS at $1.
verify_against_sums() { # sums_file file asset_name
  local expected actual
  expected="$(awk -v n="$3" '{ sub(/^\*/, "", $2); if ($2 == n) { print $1; exit } }' "$1")"
  [[ -n "$expected" ]] || die "$3 is not listed in the release SHA256SUMS"
  actual="$(sha256_of "$2")"
  [[ "$actual" == "$expected" ]] || die "sha256 mismatch for $3: expected $expected, got $actual"
}

step "Downloading VRCNext Bridge ($BRIDGE_VERSION, $BRIDGE_ASSET)"
fetch "$(release_url "$BRIDGE_REPO" "$BRIDGE_VERSION" "$SUMS_ASSET")" "$TMP/bridge.sums"
fetch "$(release_url "$BRIDGE_REPO" "$BRIDGE_VERSION" "$BRIDGE_ASSET")" "$TMP/vrcnext-bridge"
verify_against_sums "$TMP/bridge.sums" "$TMP/vrcnext-bridge" "$BRIDGE_ASSET"
note "sha256 ok"

step "Downloading plugin host sources ($HOST_VERSION)"
fetch "$(release_url "$HOST_REPO" "$HOST_VERSION" "$SUMS_ASSET")" "$TMP/host.sums"
fetch "$(release_url "$HOST_REPO" "$HOST_VERSION" "$HOST_ASSET")" "$TMP/$HOST_ASSET"
verify_against_sums "$TMP/host.sums" "$TMP/$HOST_ASSET" "$HOST_ASSET"
mkdir -p "$TMP/host"
tar -xzf "$TMP/$HOST_ASSET" -C "$TMP/host" || die "could not extract $HOST_ASSET"
[[ -f "$TMP/host/packages/host/src/index.ts" ]] \
  || die "$HOST_ASSET does not contain packages/host/src/index.ts"
note "sha256 ok"

step "Downloading esbuild $ESBUILD_VERSION ($ESBUILD_PLATFORM)"
fetch "$ESBUILD_URL" "$TMP/esbuild.tgz"
ACTUAL="$(sha256_of "$TMP/esbuild.tgz")"
[[ "$ACTUAL" == "$ESBUILD_SHA256" ]] \
  || die "sha256 mismatch for esbuild tarball: expected $ESBUILD_SHA256, got $ACTUAL"
tar -xzf "$TMP/esbuild.tgz" -C "$TMP" package/bin/esbuild || die "could not extract package/bin/esbuild"
chmod 755 "$TMP/package/bin/esbuild"
ESBUILD_BIN_SHA256="$(sha256_of "$TMP/package/bin/esbuild")"
note "sha256 ok (binary $ESBUILD_BIN_SHA256)"

# ---------------------------------------------------------------------------------------------
# Stop a running bridge before swapping its binary, then install the layout.
# ---------------------------------------------------------------------------------------------
UID_NUM="$(id -u)"
stop_bridge() {
  if [[ "$OS_TAG" == linux ]]; then
    if command -v systemctl >/dev/null 2>&1; then systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true; fi
  else
    launchctl bootout "gui/$UID_NUM/$LAUNCHD_LABEL" 2>/dev/null || true
  fi
}

step "Installing into $DATA_DIR"
UPGRADE=0
[[ -f "$BRIDGE_BIN" ]] && UPGRADE=1
mkdir -p "$BIN_DIR" "$DATA_DIR/plugins" "$DATA_DIR/build" "$THEME_DIR"
(( UPGRADE )) && { note "existing install: stopping the bridge, keeping plugins/, state.json, token"; stop_bridge; }
install -m 755 "$TMP/vrcnext-bridge" "$BRIDGE_BIN.new" && mv -f "$BRIDGE_BIN.new" "$BRIDGE_BIN"
install -m 755 "$TMP/package/bin/esbuild" "$BIN_DIR/esbuild.new" && mv -f "$BIN_DIR/esbuild.new" "$BIN_DIR/esbuild"
printf '%s\n' "$ESBUILD_BIN_SHA256" > "$BIN_DIR/esbuild.sha256"
# host/ is read-only input for the build; replace it wholesale so stale files never linger.
rm -rf "$DATA_DIR/host.new"
mv "$TMP/host" "$DATA_DIR/host.new"
rm -rf "$DATA_DIR/host"
mv "$DATA_DIR/host.new" "$DATA_DIR/host"
note "bin/vrcnext-bridge, bin/esbuild (+ .sha256), host/"

# theme folder: VRCNext lists a custom theme by folder; info.json carries author/version.
cat > "$THEME_DIR/info.json" <<JSON
{
  "author": "vrcnext-plugins",
  "version": "$HOST_VERSION"
}
JSON
note "theme folder $THEME_DIR"

# ---------------------------------------------------------------------------------------------
# settings.json: enable the theme, optionally pin the port. Only with jq and VRCNext closed,
# because VRCNext rewrites settings.json on exit and would undo the change.
# ---------------------------------------------------------------------------------------------
configure_settings() {
  if ! command -v jq >/dev/null 2>&1; then
    [[ -n "$PIN_PORT" ]] && die "--pin-port needs jq, which is not installed"
    note "jq not found; enable the theme manually: Settings -> Design -> Themes -> $THEME_NAME"
    return 0
  fi
  if [[ ! -f "$SETTINGS" ]]; then
    [[ -n "$PIN_PORT" ]] && die "--pin-port: $SETTINGS not found; start VRCNext once first"
    note "$SETTINGS not found (start VRCNext once); enable the theme manually later"
    return 0
  fi
  if pgrep -x VRCNext >/dev/null 2>&1; then
    [[ -n "$PIN_PORT" ]] && die "--pin-port: close VRCNext first, it rewrites settings.json on exit"
    note "VRCNext is running; not touching settings.json. Enable the theme under Settings -> Design -> Themes"
    return 0
  fi
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  local out="$TMP/settings.json"
  if [[ -n "$PIN_PORT" ]]; then
    jq --argjson port "$PIN_PORT" --arg theme "$THEME_NAME" \
      '.LocalHttpPort = $port | .ActiveCustomThemes = ((.ActiveCustomThemes // []) + [$theme] | unique)' \
      "$SETTINGS" > "$out" || die "jq failed to edit $SETTINGS"
    note "pinned LocalHttpPort=$PIN_PORT"
  else
    jq --arg theme "$THEME_NAME" \
      '.ActiveCustomThemes = ((.ActiveCustomThemes // []) + [$theme] | unique)' \
      "$SETTINGS" > "$out" || die "jq failed to edit $SETTINGS"
  fi
  mv -f "$out" "$SETTINGS"
  note "enabled theme \"$THEME_NAME\" in settings.json (backup written)"
}
step "Configuring VRCNext"
configure_settings

# ---------------------------------------------------------------------------------------------
# Autostart + start now
# ---------------------------------------------------------------------------------------------
step "Registering autostart"
if [[ "$OS_TAG" == linux ]]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$SERVICE_NAME.service" <<UNIT
[Unit]
Description=VRCNext Bridge
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=$BRIDGE_BIN
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
UNIT
  if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload 2>/dev/null; then
    systemctl --user enable "$SERVICE_NAME" >/dev/null 2>&1 || die "systemctl --user enable $SERVICE_NAME failed"
    systemctl --user restart "$SERVICE_NAME" || die "systemctl --user restart $SERVICE_NAME failed (journalctl --user -u $SERVICE_NAME)"
    note "systemd user unit $UNIT_DIR/$SERVICE_NAME.service enabled and started"
  else
    note "no systemd user session; starting the bridge in the background instead (no autostart)"
    nohup "$BRIDGE_BIN" >> "$DATA_DIR/bridge.log" 2>&1 &
  fi
else
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST="$PLIST_DIR/$LAUNCHD_LABEL.plist"
  mkdir -p "$PLIST_DIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key><array><string>$BRIDGE_BIN</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$DATA_DIR/bridge.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/bridge.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$UID_NUM/$LAUNCHD_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$PLIST" || die "launchctl bootstrap failed for $PLIST"
  launchctl kickstart -k "gui/$UID_NUM/$LAUNCHD_LABEL" 2>/dev/null || true
  note "launchd agent $PLIST loaded"
fi

# ---------------------------------------------------------------------------------------------
# Wait for the daemon, pair, build the first bundle
# ---------------------------------------------------------------------------------------------
step "Waiting for the bridge on http://$BRIDGE_ADDR"
for _ in $(seq 1 60); do
  curl -fsS -m 2 "http://$BRIDGE_ADDR/v1/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://$BRIDGE_ADDR/v1/health" >/dev/null 2>&1 \
  || die "bridge did not answer /v1/health within 30 s (see $DATA_DIR/bridge.log)"

# The bridge writes the token on its first start, possibly a moment after /v1/health is up.
for _ in $(seq 1 20); do
  [[ -s "$TOKEN_FILE" ]] && break
  sleep 0.5
done
[[ -s "$TOKEN_FILE" ]] || die "token file $TOKEN_FILE was not created by the bridge"
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"

# Built by the binary itself rather than over HTTP: the daemon's REST call surface is off unless
# it is started with --rest, and an install should not have to open a second way in to compile a
# bundle. Same code, same paths, no socket.
step "Building the plugin bundle"
BUILD_OUT="$TMP/build.json"
"$BRIDGE_BIN" --build-plugins >"$BUILD_OUT" 2>"$TMP/build.err" \
  || die "building the bundle failed: $(head -c 600 "$TMP/build.err" "$BUILD_OUT")"
grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$BUILD_OUT" \
  || die "build failed: $(head -c 600 "$BUILD_OUT")"
[[ -f "$THEME_DIR/vrcnext-plugin-host.js" ]] \
  || die "build reported ok but $THEME_DIR/vrcnext-plugin-host.js is missing"
note "$THEME_DIR/vrcnext-plugin-host.js"

# ---------------------------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------------------------
WIDTH=$(( ${#TOKEN} + 4 ))
BAR="$(printf '%*s' "$WIDTH" '' | tr ' ' '-')"
printf '\n%s%sInstalled.%s Your pairing token:\n\n' "$C_GREEN" "$C_BOLD" "$C_RESET"
printf '  +%s+\n' "$BAR"
printf '  |  %s%s%s  |\n' "$C_BOLD" "$TOKEN" "$C_RESET"
printf '  +%s+\n\n' "$BAR"
printf '  1. In VRCNext: Settings -> Design -> Themes, enable "%s" (restart VRCNext if it was open).\n' "$THEME_NAME"
printf '  2. Open the new Plugins tab in the sidebar.\n'
printf '  3. Paste the token above into the Bridge card.\n\n'
printf '  %sToken file: %s   Log: %s/bridge.log   Print again: %s --print-token%s\n' \
  "$C_DIM" "$TOKEN_FILE" "$DATA_DIR" "$BRIDGE_BIN" "$C_RESET"
