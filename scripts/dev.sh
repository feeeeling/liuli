#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ ! -d "$ROOT/daemon/node_modules" ]]; then
  echo "Installing daemon dependencies…"
  (cd "$ROOT/daemon" && npm install)
fi

echo "Building 琉璃.app (debug)…"
(cd "$ROOT/app" && swift build -c debug --product Liuli)

BIN="$ROOT/app/.build/debug/Liuli"
if [[ ! -x "$BIN" ]]; then
  BIN="$ROOT/app/.build/arm64-apple-macosx/debug/Liuli"
fi
if [[ ! -x "$BIN" ]]; then
  echo "Liuli debug binary not found" >&2
  exit 1
fi

APP="$ROOT/dist/Liuli.app"
# Keep the same .app path and signing identity so TCC (屏幕录制 / 辅助功能) sticks.
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Liuli"
cp "$ROOT/app/Resources/Info.plist" "$APP/Contents/Info.plist"
echo -n 'APPL????' >"$APP/Contents/PkgInfo"
ln -sfn "$ROOT/daemon" "$APP/Contents/Resources/daemon"

IDENTITY="$("$ROOT/scripts/ensure-signing-identity.sh")"
if [[ "$IDENTITY" == "-" ]]; then
  codesign --force --sign - --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || true
else
  codesign --force --sign "$IDENTITY" --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || \
    codesign --force --sign - --identifier app.liuli.desktop --timestamp=none "$APP" >/dev/null 2>&1 || true
fi

pkill -f "$APP/Contents/MacOS/Liuli" 2>/dev/null || true
sleep 0.3
echo "Opening $APP"
open "$APP"
echo "菜单栏应出现「琉璃」。授权一次即可；不要删掉 dist/Liuli.app。"
