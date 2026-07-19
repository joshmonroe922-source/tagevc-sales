#!/usr/bin/env bash
# Safe production deploy for Tage portal (portal.tagevc.com).
#
# Serializes deploys with an atomic lock and refuses to deploy unless
# TypeScript passes — so mid-edit snapshots never reach Vercel.
#
# Deploy policy: run only when Josh says "Deploy". Agents must not
# deploy without Josh saying "Deploy". Test on localhost first.
#
# Before production deploy, apply any new Supabase migrations — see DEV_WORKFLOW.md.
#
# Usage: npm run deploy

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

echo "▶ Typechecking working tree before deploy..."
if ! npm run --silent typecheck; then
  echo "✗ Typecheck failed. Deploy aborted — fix the errors above first."
  exit 1
fi

echo "✓ Typecheck clean. Deploying to production..."
exec npx vercel --prod --yes "$@"
