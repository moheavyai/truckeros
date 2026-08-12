#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIR=scripts/equipment-page-parts
OUT=app/equipment/page.tsx
if [[ ! -d "$DIR" ]]; then
  echo "Missing $DIR — git pull first"
  exit 1
fi
cat "$DIR"/part*.tsx > "$OUT"
if head -1 "$OUT" | grep -q "use client" && grep -q "rigBuilderOpen" "$OUT"; then
  echo "OK: wrote $OUT ($(wc -c < "$OUT") bytes) with empty-state flow"
else
  echo "ERROR: assembled file looks wrong (need all parts 00-09)"
  exit 1
fi
