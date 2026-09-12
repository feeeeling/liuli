#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/app/Resources"
OUT="$DIR/AppIcon-1024.png.b64"
shopt -s nullglob
parts=("$DIR"/AppIcon-1024.png.b64.part*)
if [[ ${#parts[@]} -eq 0 ]]; then
  echo "no parts" >&2
  exit 1
fi
cat "${parts[@]}" >"$OUT"
echo "wrote $OUT"
