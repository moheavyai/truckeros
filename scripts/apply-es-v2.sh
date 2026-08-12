#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIR=patches/es-v2
OUT=patches/equipment-empty-state-v2.patch
if [[ ! -f "$DIR/p0.b64" ]]; then
  echo "Missing $DIR — git pull first"
  exit 1
fi
cat "$DIR"/p*.b64 | base64 -d > "$OUT"
git apply --check "$OUT"
git apply "$OUT"
echo "OK: empty-state flow applied"
grep -n "rigBuilderOpen\|Specialty\|type Tab" app/equipment/page.tsx | head -10
