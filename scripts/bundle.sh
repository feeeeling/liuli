#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/app/.build/release/Liuli"
if [[ ! -x "$BIN" ]]; then
  BIN="$ROOT/app/.build/debug/Liuli"
fi
if [[ ! -x "$BIN" ]]; then
  echo "Liuli binary not found. Run: make app" >&2
  exit 1
fi

APP="$ROOT/dist/Liuli.app"
if [[ -L "$APP/Contents/Resources/daemon" ]]; then
  rm -f "$APP/Contents/Resources/daemon"
fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/daemon"
cp "$BIN" "$APP/Contents/MacOS/Liuli"
cp "$ROOT/app/Resources/Info.plist" "$APP/Contents/Info.plist"
echo -n 'APPL????' >"$APP/Contents/PkgInfo"

# Materialize AppIcon PNG from b64 when needed (Linux-authored assets)
ICON_PNG="$ROOT/app/Resources/AppIcon-1024.png"
ICON_B64="$ROOT/app/Resources/AppIcon-1024.png.b64"
if [[ ! -f "$ICON_PNG" && -f "$ICON_B64" ]]; then
  if base64 --help 2>&1 | grep -q -- '-D'; then
    base64 -D -i "$ICON_B64" -o "$ICON_PNG"
  else
    base64 -d "$ICON_B64" >"$ICON_PNG"
  fi
fi
README_ICON="$ROOT/docs/assets/icon.png"
README_B64="$ROOT/docs/assets/icon.png.b64"
if [[ ! -f "$README_ICON" && -f "$README_B64" ]]; then
  mkdir -p "$ROOT/docs/assets"
  if base64 --help 2>&1 | grep -q -- '-D'; then
    base64 -D -i "$README_B64" -o "$README_ICON"
  else
    base64 -d "$README_B64" >"$README_ICON"
  fi
fi

# Build .icns on macOS when iconutil + sips exist
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
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi

if [[ ! -d "$ROOT/daemon/node_modules" ]]; then
  (cd "$ROOT/daemon" && npm install)
fi
(cd "$ROOT/daemon" && npm run build)
cp "$ROOT/daemon/dist/index.mjs" "$APP/Contents/Resources/daemon/index.mjs"
cp "$ROOT/daemon/package.json" "$APP/Contents/Resources/daemon/package.json"
rsync -a --delete \
  --exclude typescript \
  --exclude tsx \
  --exclude esbuild \
  --exclude '@esbuild' \
  --exclude '@types' \
  "$ROOT/daemon/node_modules" "$APP/Contents/Resources/daemon/"
"$ROOT/scripts/prune-daemon-modules.sh" "$APP/Contents/Resources/daemon/node_modules"

if [[ -x "$ROOT/runtime/node" ]]; then
  mkdir -p "$APP/Contents/Resources/runtime"
  cp "$ROOT/runtime/node" "$APP/Contents/Resources/runtime/node"
fi

IDENTITY="$("$ROOT/scripts/ensure-signing-identity.sh")"
if [[ "$IDENTITY" == "-" ]]; then
  codesign --force --sign - --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || true
else
  codesign --force --sign "$IDENTITY" --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || \
    codesign --force --sign - --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || true
fi
echo "Built $APP"
