#!/usr/bin/env bash
# The one verification gate: every check this repository has, in one run, ending with the bundle.
#
# There is deliberately no second entry point. `scripts/build.sh` hands control back here unless
# this script invoked it, so there is no way to produce a bundle that skipped a check — which is
# the failure worth engineering against, because the bridge compiles these same sources on a
# user's machine and a check skipped here surfaces there, at install time.
#
# Output is never filtered — a hidden warning is the thing this exists to catch. Anything calling
# this script shows its output too.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Type check"
npx tsc --build --force

echo "==> Type check (tooling configs)"
npx tsc -p tsconfig.tools.json

echo "==> Lint"
npx eslint . --max-warnings=0

echo "==> Tests"
npx vitest run

echo "==> Every VRCNext action and event named exists (protocol/vrcnext-protocol.json)"
node scripts/check-vrcnext-protocol.mjs packages examples/example-plugin

echo "==> Every request and every held list says why nothing existing would do"
node scripts/check-reuse.mjs packages examples/example-plugin

echo "==> API version agrees with packages/api/package.json"
API_PKG_VERSION="$(node -p "require('./packages/api/package.json').version")"
HOST_API_VERSION="$(sed -n "s/.*API_VERSION = '\([^']*\)'.*/\1/p" packages/host/src/api-version.ts)"
if [[ "$API_PKG_VERSION" != "$HOST_API_VERSION" ]]; then
  echo "API_VERSION is $HOST_API_VERSION but @vrcnext/plugin-api is $API_PKG_VERSION." >&2
  exit 1
fi

echo "==> Build"
VRCNEXT_GATE_RUNNING=1 "$ROOT/scripts/build.sh"

echo "==> All checks passed"
