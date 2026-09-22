#!/usr/bin/env bash
# Installs the pinned benchmark toolchain into a benchmark-owned cache. Safe to rerun.
# Windows profiles are unusable (see README), so run this inside WSL or another Linux host.
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.4.2}"
# Node 22 avoids the libatomic dependency of newer official Linux builds.
NODE_VERSION="${NODE_VERSION:-22.20.0}"
cache_root="$(realpath -m -- "${XDG_CACHE_HOME:-$HOME/.cache}/postplan-benchmark")"
toolchains="$cache_root/toolchains"
bun_dir="$toolchains/bun-$BUN_VERSION"
node_dir="$toolchains/node-$NODE_VERSION"
mkdir -p "$toolchains"
temporary="$(mktemp -d "$cache_root/setup.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT

if ! "$bun_dir/bin/bun" --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
  curl -fsSL -o "$temporary/bun.zip" \
    "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"
  # python3 avoids requiring unzip.
  python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
    "$temporary/bun.zip" "$temporary"
  mkdir -p "$temporary/bun/bin"
  install -m 755 "$temporary/bun-linux-x64/bun" "$temporary/bun/bin/bun"
  rm -rf -- "$bun_dir"
  mv "$temporary/bun" "$bun_dir"
fi

if ! "$node_dir/bin/node" --version 2>/dev/null | grep -qx "v$NODE_VERSION"; then
  curl -fsSL -o "$temporary/node.tar.xz" \
    "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  mkdir -p "$temporary/node"
  tar -xJf "$temporary/node.tar.xz" -C "$temporary/node" --strip-components=1
  rm -rf -- "$node_dir"
  mv "$temporary/node" "$node_dir"
fi

command -v rsync >/dev/null || { echo "rsync is required (sudo apt install rsync)." >&2; exit 1; }
echo "bun $("$bun_dir/bin/bun" --version), node $("$node_dir/bin/node" --version)"
echo "installed under $toolchains"
