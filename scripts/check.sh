#!/usr/bin/env bash
# Full verification gate. Output is never filtered — a hidden warning is the thing this exists
# to catch.
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

echo "==> API version agrees with packages/api/package.json"
API_PKG_VERSION="$(node -p "require('./packages/api/package.json').version")"
HOST_API_VERSION="$(sed -n "s/.*API_VERSION = '\([^']*\)'.*/\1/p" packages/host/src/api-version.ts)"
if [[ "$API_PKG_VERSION" != "$HOST_API_VERSION" ]]; then
  echo "API_VERSION is $HOST_API_VERSION but @vrcnext/plugin-api is $API_PKG_VERSION." >&2
  exit 1
fi

echo "==> Build"
"$ROOT/scripts/build.sh"

echo "==> All checks passed"
