#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
export HOME="$temporary/home"
export XDG_CACHE_HOME="$temporary/cache"
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$temporary/outside"
touch "$temporary/outside/keep"
owned="$XDG_CACHE_HOME/postplan-benchmark/workdirs"

reject() {
  local candidate="$1"
  if BENCH_VALIDATE_ONLY=true BENCH_WORKDIR="$candidate" bash "$here/run.sh" test \
    > /dev/null 2>&1; then
    echo "expected rejection: $candidate" >&2
    exit 1
  fi
}

reject ""
reject "/"
reject "$HOME"
reject "$(cd "$here/../.." && pwd)"
reject "$temporary/outside"
test -f "$temporary/outside/keep"

mkdir -p "$owned"
ln -s "$temporary/outside" "$owned/escaped"
reject "$owned/escaped"
test -f "$temporary/outside/keep"

BENCH_VALIDATE_ONLY=true BENCH_WORKDIR="$owned/safe" bash "$here/run.sh" test > /dev/null
test -f "$temporary/outside/keep"
echo "benchmark workdir safety checks passed"
