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
"$ROOT/scripts/embed-icons.sh" "$APP"

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
