#!/usr/bin/env bash
# Copy app icon into a Liuli.app bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-}"
if [[ -z "$APP" || ! -d "$APP/Contents" ]]; then
  echo "usage: embed-icons.sh <Liuli.app>" >&2
  exit 1
fi

RES="$APP/Contents/Resources"
mkdir -p "$RES"

ICON_PNG="$ROOT/app/Resources/AppIcon-1024.png"
if [[ -f "$ICON_PNG" ]] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for spec in \
    "16 icon_16x16.png" \
    "32 icon_16x16@2x.png" \
    "32 icon_32x32.png" \
    "64 icon_32x32@2x.png" \
    "128 icon_128x128.png" \
    "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" \
    "512 icon_256x256@2x.png" \
    "512 icon_512x512.png" \
    "1024 icon_512x512@2x.png"
  do
    set -- $spec
    sips -z "$1" "$1" "$ICON_PNG" --out "$ICONSET/$2" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi
