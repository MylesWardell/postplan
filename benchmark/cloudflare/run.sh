#!/usr/bin/env bash
# Builds a disposable copy of the repository with the benchmark entry, starts it locally and
# profiles each case into results/<tag>/.
#
# Usage: run.sh <tag> [case,case...]
#   BENCH_TAR=/path/source.tar  benchmark an exported tree (for example a baseline commit)
#                               instead of the current working tree
#   BENCH_PATCH=/path/patch.sh  run a script in the copy before building (an experiment)
#   BENCH_WORKDIR               disposable copy location (default ~/postplan-bench)
#   BENCH_PORT / BENCH_INSPECTOR_PORT  default 5199 / 9239
set -euo pipefail

tag="${1:?Usage: run.sh <tag> [case,case...]}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="${BENCH_WORKDIR:-$HOME/postplan-bench}"
port="${BENCH_PORT:-5199}"
inspector="${BENCH_INSPECTOR_PORT:-9239}"
export PATH="$HOME/.node/bin:$HOME/.bun/bin:$PATH"
export BENCH_PORT="$port" BENCH_INSPECTOR_PORT="$inspector" CI=true

mkdir -p "$work"
# Resolve inputs before changing directory.
[ -n "${BENCH_TAR:-}" ] && BENCH_TAR="$(realpath "$BENCH_TAR")"
[ -n "${BENCH_PATCH:-}" ] && BENCH_PATCH="$(realpath "$BENCH_PATCH")"
if [ -n "${BENCH_TAR:-}" ]; then
  # Keep installed dependencies; replace everything else with the exported tree.
  find "$work" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  tar -xf "$BENCH_TAR" -C "$work"
else
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude .turbo --exclude .wrangler --exclude dist \
    --exclude .local --exclude generated --exclude benchmark/cloudflare/results \
    "$repo/" "$work/"
fi
cp "$here/worker.ts" "$work/packages/cloudflare/src/worker.ts"
if [ -n "${BENCH_PATCH:-}" ]; then
  (cd "$work" && bash "$BENCH_PATCH")
fi

cd "$work"
bun install --frozen-lockfile --ignore-scripts > /tmp/postplan-bench-install.log 2>&1 ||
  { tail -20 /tmp/postplan-bench-install.log; exit 1; }
bun x --no-install turbo run cf:build --filter=@postplan/cloudflare > /tmp/postplan-bench-build.log 2>&1 ||
  { tail -40 /tmp/postplan-bench-build.log; exit 1; }

cd packages/cloudflare
rm -rf .wrangler/bench
bun x --no-install wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/bench \
  --port "$port" --inspector-port "$inspector" --local \
  --var POSTPLAN_APPLICATION_ENABLED:true --var POSTPLAN_SESSION_SECRET:local-session-only \
  > /tmp/postplan-bench-worker.log 2>&1 &
worker=$!
cleanup() {
  kill "$worker" 2>/dev/null || true
  pkill -f "workerd.*$port" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 90); do
  grep -q "Ready on" /tmp/postplan-bench-worker.log && break
  sleep 1
done
grep -q "Ready on" /tmp/postplan-bench-worker.log || { tail -40 /tmp/postplan-bench-worker.log; exit 1; }

node "$here/profile.mjs" "$tag" "${2:-}"
node "$here/compare.mjs" "$tag"
