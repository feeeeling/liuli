#!/usr/bin/env bash
# Drop build-only and foreign-platform files from a copied daemon node_modules.
# Pi's shrinkwrap installs esbuild binaries for every OS (~280MB); we only need darwin.
set -euo pipefail

NM="${1:-}"
if [[ -z "$NM" || ! -d "$NM" ]]; then
  echo "usage: prune-daemon-modules.sh <node_modules>" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) KEEP_ESBUILD=darwin-arm64 ;;
  x86_64) KEEP_ESBUILD=darwin-x64 ;;
  *) KEEP_ESBUILD="" ;;
esac

# Our daemon is already esbuild'd to index.mjs — tsx/typescript/esbuild are build-time only.
rm -rf \
  "$NM/typescript" \
  "$NM/tsx" \
  "$NM/esbuild" \
  "$NM/@esbuild" \
  "$NM/@types" \
  "$NM/.bin/tsx" \
  "$NM/.bin/tsserver" \
  "$NM/.bin/tsc" \
  "$NM/.bin/esbuild"

# Docs / examples shipped inside pi-coding-agent
rm -rf \
  "$NM/@earendil-works/pi-coding-agent/docs" \
  "$NM/@earendil-works/pi-coding-agent/examples"

# Source maps
find "$NM" -name '*.map' -type f -delete

# Nested @esbuild: keep only this Mac's binary
while IFS= read -r dir; do
  [[ -d "$dir" ]] || continue
  find "$dir" -mindepth 1 -maxdepth 1 -type d ! -name "$KEEP_ESBUILD" -exec rm -rf {} +
done < <(find "$NM" -type d -name '@esbuild')

# Other-OS native addons (clipboard, TUI prebuilds)
find "$NM" -type d \( \
    -name 'clipboard-linux-*' -o \
    -name 'clipboard-win32-*' -o \
    -name 'clipboard-darwin-x64' -o \
    -name 'win32' -o \
    -name 'linux' \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

if [[ "$ARCH" == "arm64" ]]; then
  find "$NM" -type d -name 'darwin-x64' -prune -exec rm -rf {} + 2>/dev/null || true
elif [[ "$ARCH" == "x86_64" ]]; then
  find "$NM" -type d -name 'darwin-arm64' -prune -exec rm -rf {} + 2>/dev/null || true
fi
