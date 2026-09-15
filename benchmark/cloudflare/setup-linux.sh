#!/usr/bin/env bash
# Installs the benchmark toolchain into the current Linux user's home. Safe to rerun.
# Windows profiles are unusable (see README), so run this inside WSL or another Linux host.
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.4.2}"
# Node 22 avoids the libatomic dependency of newer official Linux builds.
NODE_VERSION="${NODE_VERSION:-22.20.0}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! "$HOME/.bun/bin/bun" --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
  curl -fsSL -o "$tmp/bun.zip" \
    "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"
  # python3 avoids requiring unzip.
  python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
    "$tmp/bun.zip" "$tmp"
  mkdir -p "$HOME/.bun/bin"
  install -m 755 "$tmp/bun-linux-x64/bun" "$HOME/.bun/bin/bun"
fi

if ! "$HOME/.node/bin/node" --version 2>/dev/null | grep -qx "v$NODE_VERSION"; then
  curl -fsSL -o "$tmp/node.tar.xz" \
    "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  rm -rf "$HOME/.node"
  mkdir -p "$HOME/.node"
  tar -xJf "$tmp/node.tar.xz" -C "$HOME/.node" --strip-components=1
fi

command -v rsync >/dev/null || { echo "rsync is required (sudo apt install rsync)." >&2; exit 1; }
echo "bun $("$HOME/.bun/bin/bun" --version), node $("$HOME/.node/bin/node" --version)"
