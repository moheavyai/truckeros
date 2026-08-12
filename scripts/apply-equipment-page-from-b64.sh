#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
DIR="scripts/equipment-page-b64"
OUT="app/equipment/page.tsx"
if [[ ! -d "$DIR" ]]; then
  echo "Missing $DIR — pull latest branch first"
  exit 1
fi
cat "$DIR"/part*.b64 | base64 -d > "$OUT"
echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"
grep -q "rigBuilderOpen" "$OUT" && echo "OK: rigBuilderOpen present"
grep -q "Specialty" "$OUT" && echo "OK: Specialty axle present"
grep -q "type Tab = 'tractors' | 'trailers' | 'rigs'" "$OUT" && echo "OK: Rigs tab type"
