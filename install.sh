#!/usr/bin/env bash
set -euo pipefail

REPO="${LIULI_REPO:-feeeeling/liuli}"
BRANCH="${LIULI_BRANCH:-main}"
DEST="${LIULI_DEST:-$HOME/Applications}"
SRC="${LIULI_SRC:-$HOME/.liuli/src}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "琉璃只支持 macOS。" >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "需要 Xcode Command Line Tools。正在唤起安装…" >&2
  xcode-select --install || true
  echo "安装完成后重新运行本命令。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 22+。可用: brew install node" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "需要 git。" >&2
  exit 1
fi

mkdir -p "$SRC" "$DEST"
if [[ -d "$SRC/.git" ]]; then
  echo "更新源码 $SRC"
  git -C "$SRC" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC" checkout -q "$BRANCH"
  git -C "$SRC" reset --hard "origin/$BRANCH"
else
  echo "克隆 https://github.com/$REPO"
  rm -rf "$SRC"
  git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$SRC"
fi

cd "$SRC"
make daemon-install
if [[ ! -x "$SRC/runtime/node" ]]; then
  "$SRC/scripts/vendor-node.sh" || echo "未打进 Node 运行时，将使用系统 node。"
fi
make app

APP_SRC="$SRC/dist/Liuli.app"
if [[ ! -d "$APP_SRC" ]]; then
  echo "构建失败：找不到 $APP_SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -rf "$DEST/Liuli.app"
cp -R "$APP_SRC" "$DEST/Liuli.app"
xattr -dr com.apple.quarantine "$DEST/Liuli.app" 2>/dev/null || true

echo
echo "已安装到 $DEST/Liuli.app"
echo "首次请在系统设置里打开：辅助功能、屏幕录制。"
echo "模型登录：打开琉璃设置 → 账号，或先运行 pi login。"
open "$DEST/Liuli.app"
