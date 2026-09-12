#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/app/Resources"
shopt -s nullglob
join_one() {
  local base="$1"
  local out="$DIR/$base"
  local parts=("$DIR"/"$base".part*)
  if [[ ${#parts[@]} -eq 0 ]]; then
    return 0
  fi
  cat "${parts[@]}" >"$out"
  rm -f "$DIR"/"$base".part*
  echo "joined $out"
}
join_one AppIcon-foreground-L2-512.png.b64
join_one AppIcon-foreground-L2-1024.png.b64
join_one AppIcon-1024.png.b64
