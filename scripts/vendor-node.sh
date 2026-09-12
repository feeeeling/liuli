#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${NODE_VERSION:-24.14.1}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) echo "unsupported arch $ARCH" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-darwin-${NODE_ARCH}.tar.gz"
echo "Downloading $URL"
curl -fsSL "$URL" | tar -xz -C "$TMP"
mkdir -p "$ROOT/runtime"
cp "$TMP/node-v${VERSION}-darwin-${NODE_ARCH}/bin/node" "$ROOT/runtime/node"
chmod +x "$ROOT/runtime/node"
echo "Installed $ROOT/runtime/node"
