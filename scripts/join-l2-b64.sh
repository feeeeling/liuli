#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/app/Resources"
shopt -s nullglob
join_one() {
  local base="$1"
  local expected="${2:-0}"
  local out="$DIR/$base"
  local parts=("$DIR"/"$base".part*)
  if [[ ${#parts[@]} -eq 0 ]]; then
    return 0
  fi
  if [[ "$expected" -gt 0 && ${#parts[@]} -ne "$expected" ]]; then
    echo "incomplete $base: have ${#parts[@]} expected $expected" >&2
    return 0
  fi
  cat "${parts[@]}" >"$out"
  rm -f "$DIR"/"$base".part*
  echo "joined $out"
}
# Prefer 12×~12KB parts; if using 8KB splits set expected=18
join_one AppIcon-foreground-L2-512.png.b64 12
join_one AppIcon-foreground-L2-1024.png.b64 0
join_one AppIcon-1024.png.b64 0
