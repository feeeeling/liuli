#!/usr/bin/env bash
# Join AppIcon-foreground-L2-512.png.z64.part* → .z64 → PNG (zlib).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/app/Resources"
BASE=AppIcon-foreground-L2-512.png.z64
EXPECTED=36
shopt -s nullglob
parts=("$DIR"/"$BASE".part*)
if [[ ${#parts[@]} -eq 0 ]]; then
  echo "no z64 parts"
  exit 0
fi
if [[ ${#parts[@]} -ne "$EXPECTED" ]]; then
  echo "incomplete: have ${#parts[@]} expected $EXPECTED" >&2
  exit 1
fi
cat "${parts[@]}" >"$DIR/$BASE"
rm -f "$DIR"/"$BASE".part*
python3 - "$DIR/$BASE" "${DIR%/}/AppIcon-foreground-L2-512.png" <<'PY'
import sys, base64, zlib
src, dst = sys.argv[1], sys.argv[2]
open(dst, "wb").write(zlib.decompress(base64.b64decode(open(src).read())))
print("wrote", dst)
PY
rm -f "$DIR/$BASE"
echo "done"
