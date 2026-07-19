#!/usr/bin/env bash
# Preview / staging deploy for Tage portal (non-production).
#
# Usage: npm run deploy:preview
#
# Prefer pushing a `staging` branch and letting Vercel build a branch preview
# automatically — see DEV_WORKFLOW.md. This script is for manual preview deploys.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK_DIR="$ROOT/.vercel/deploy.lock"

cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "✗ Another deploy is already running (lock: $LOCK_DIR)."
  echo "  Wait for it to finish, or remove the lock if it is stale:"
  echo "    rmdir '$LOCK_DIR'"
  exit 1
fi
trap cleanup EXIT

echo "▶ Typechecking working tree before preview deploy..."
if ! npm run --silent typecheck; then
  echo "✗ Typecheck failed. Preview deploy aborted."
  exit 1
fi

echo "✓ Typecheck clean. Deploying preview (NOT production)..."
exec npx vercel --yes "$@"
