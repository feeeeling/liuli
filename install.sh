#!/usr/bin/env bash
set -euo pipefail

REPO="${LIULI_REPO:-feeeeling/liuli}"
BRANCH="${LIULI_BRANCH:-main}"
DEST="${LIULI_DEST:-$HOME/Applications}"
SRC="${LIULI_SRC:-$HOME/.liuli/src}"
FROM_SOURCE="${LIULI_FROM_SOURCE:-0}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "琉璃只支持 macOS。" >&2
  exit 1
fi

export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

ensure_pi() {
  if command -v pi >/dev/null 2>&1; then
    echo "已检测到 pi：$(command -v pi)"
    pi --version 2>/dev/null || true
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
    echo "未检测到 pi，且没有 Node/npm，跳过 CLI 安装。可稍后: npm i -g --ignore-scripts @earendil-works/pi-coding-agent"
    return 0
  fi
  echo "未检测到 pi CLI，正在安装 @earendil-works/pi-coding-agent…"
  if command -v npm >/dev/null 2>&1 && npm install -g --ignore-scripts @earendil-works/pi-coding-agent; then
    hash -r 2>/dev/null || true
    if command -v pi >/dev/null 2>&1; then
      echo "pi 已安装：$(command -v pi)"
      return 0
    fi
  fi
  echo "npm 全局安装失败，改用官方安装脚本…"
  curl -fsSL https://pi.dev/install.sh | sh
  export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:/usr/local/bin:${PATH}"
  hash -r 2>/dev/null || true
  if command -v pi >/dev/null 2>&1; then
    echo "pi 已安装：$(command -v pi)"
    return 0
  fi
  echo "警告：pi CLI 未装上。琉璃仍可运行，请在 App 设置 → 账号里登录。"
}

install_app() {
  local app_src="$1"
  mkdir -p "$DEST"
  rm -rf "$DEST/Liuli.app"
  cp -R "$app_src" "$DEST/Liuli.app"
  xattr -dr com.apple.quarantine "$DEST/Liuli.app" 2>/dev/null || true
  echo "已安装到 $DEST/Liuli.app"
}

download_release() {
  local url zip tmp
  echo "查找 GitHub Releases 预编译包…"
  url="$(python3 - "$REPO" <<'PY'
import json, sys, urllib.error, urllib.request
repo = sys.argv[1]
req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/releases/latest",
    headers={"Accept": "application/vnd.github+json", "User-Agent": "liuli-installer"},
)
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
except urllib.error.HTTPError as e:
    sys.exit(1)
for asset in data.get("assets") or []:
    name = asset.get("name") or ""
    if name.endswith(".zip") and "Liuli" in name:
        print(asset["browser_download_url"])
        sys.exit(0)
sys.exit(1)
PY
)" || return 1
  [[ -n "$url" ]] || return 1
  echo "下载 $url"
  tmp="$(mktemp -d)"
  zip="$tmp/Liuli.zip"
  curl -fL --progress-bar -o "$zip" "$url"
  ditto -x -k "$zip" "$tmp"
  local extracted
  extracted="$(find "$tmp" -name 'Liuli.app' -type d -print -quit)"
  [[ -d "$extracted" ]] || return 1
  install_app "$extracted"
  rm -rf "$tmp"
}

build_from_source() {
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "需要 Xcode Command Line Tools。正在唤起安装…" >&2
    xcode-select --install || true
    echo "安装完成后重新运行本命令。" >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "从源码编译需要 Node.js 22+。可用: brew install node" >&2
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
  install_app "$SRC/dist/Liuli.app"
}

if [[ "$FROM_SOURCE" != "1" ]] && download_release; then
  echo "已使用预编译包（跳过本地编译）。"
else
  if [[ "$FROM_SOURCE" == "1" ]]; then
    echo "LIULI_FROM_SOURCE=1，从源码编译。"
  else
    echo "没有可用的 Release，改为源码编译（较慢）。"
  fi
  build_from_source
fi

ensure_pi

echo
echo "首次请在系统设置里打开：辅助功能、屏幕录制。"
echo "模型登录：打开琉璃设置 → 账号，或运行 pi login。"
open "$DEST/Liuli.app"
