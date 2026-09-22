#!/usr/bin/env bash
# Builds benchmark-owned disposable copies, starts them locally and profiles every case.
#
# Usage: run.sh <tag> [case,case...]
#   BENCH_TAR=/path/source.tar          benchmark an exported tree instead of the working tree
#   BENCH_PATCH=/path/patch.sh          patch the disposable current copy before building
#   BENCH_WORKDIR                       copy location; must be below the owned workdirs directory
#   BENCH_BASELINE_TAR=/path/base.tar   enable interleaved A/B profiling against this archive
#   BENCH_BASELINE_TAG                  result tag for the baseline (default: baseline)
#   BENCH_PORT / BENCH_INSPECTOR_PORT   first target's ports (default: 5199 / 9239)
set -euo pipefail

fail() {
  echo "benchmark: $*" >&2
  exit 1
}

tag="${1:?Usage: run.sh <tag> [case,case...]}"
cases="${2:-}"
[[ "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || fail "unsafe result tag: $tag"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
home="$(realpath -m -- "$HOME")"
cache_root="$(realpath -m -- "${XDG_CACHE_HOME:-$HOME/.cache}/postplan-benchmark")"
work_parent="$(realpath -m -- "$cache_root/workdirs")"

if [[ ${BENCH_WORKDIR+x} && -z "$BENCH_WORKDIR" ]]; then
  fail "BENCH_WORKDIR must not be empty"
fi
work="$(realpath -m -- "${BENCH_WORKDIR:-$work_parent/$tag}")"
repo="$(realpath -m -- "$repo")"

validate_workdir() {
  local candidate="$1"
  [[ -n "$candidate" ]] || fail "work directory must not be empty"
  [[ "$candidate" != "/" ]] || fail "filesystem root is not a work directory"
  [[ "$candidate" != "$home" ]] || fail "home directory is not a work directory"
  [[ "$candidate" != "$repo" ]] || fail "repository root is not a work directory"
  [[ "$candidate" != "$work_parent" ]] || fail "owned workdirs parent is not disposable"
  case "$candidate/" in
    "$work_parent/"*) ;;
    *) fail "$candidate is outside benchmark-owned parent $work_parent" ;;
  esac
}

case "$work_parent/" in
  "$repo/"*) fail "benchmark cache must not be inside the repository" ;;
esac
validate_workdir "$work"

baseline_tag="${BENCH_BASELINE_TAG:-baseline}"
baseline_work=""
if [[ -n "${BENCH_BASELINE_TAR:-}" ]]; then
  [[ "$baseline_tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] ||
    fail "unsafe baseline result tag: $baseline_tag"
  [[ "$baseline_tag" != "$tag" ]] || fail "baseline and current tags must differ"
  baseline_work="$(realpath -m -- "$work_parent/$baseline_tag")"
  validate_workdir "$baseline_work"
  [[ "$baseline_work" != "$work" ]] || fail "baseline and current work directories must differ"
fi

# Tests use this mode to prove all safety checks run before any cleanup or tool invocation.
if [[ "${BENCH_VALIDATE_ONLY:-false}" == "true" ]]; then
  printf 'validated %s\n' "$work"
  exit 0
fi

BUN_VERSION="${BUN_VERSION:-1.4.2}"
NODE_VERSION="${NODE_VERSION:-22.20.0}"
bun_bin="$cache_root/toolchains/bun-$BUN_VERSION/bin/bun"
node_bin="$cache_root/toolchains/node-$NODE_VERSION/bin/node"
[[ -x "$bun_bin" ]] || fail "run setup-linux.sh to install Bun $BUN_VERSION"
[[ -x "$node_bin" ]] || fail "run setup-linux.sh to install Node $NODE_VERSION"
[[ "$($bun_bin --version)" == "$BUN_VERSION" ]] || fail "unexpected benchmark Bun version"
[[ "$($node_bin --version)" == "v$NODE_VERSION" ]] || fail "unexpected benchmark Node version"
export PATH="$(dirname "$node_bin"):$(dirname "$bun_bin"):$PATH"
export CI=true

git_mode=linux
repo_windows=""
if [[ -z "${BENCH_TAR:-}" && -z "${BENCH_REVISION:-}" ]] &&
  ! git -C "$repo" rev-parse --git-dir > /dev/null 2>&1; then
  command -v git.exe > /dev/null && command -v wslpath > /dev/null ||
    fail "Git cannot read this worktree; set BENCH_REVISION or BENCH_TAR"
  git.exe --version > /dev/null 2>&1 ||
    fail "WSL interop is unavailable; pass BENCH_REVISION and BENCH_DIRTY from the host"
  git_mode=windows
  repo_windows="$(wslpath -w "$repo")"
fi
repo_git() {
  if [[ "$git_mode" == "windows" ]]; then
    git.exe -C "$repo_windows" "$@"
  else
    git -C "$repo" "$@"
  fi
}

mkdir -p "$work_parent"
[[ -n "${BENCH_TAR:-}" ]] && BENCH_TAR="$(realpath -- "$BENCH_TAR")"
[[ -n "${BENCH_PATCH:-}" ]] && BENCH_PATCH="$(realpath -- "$BENCH_PATCH")"
[[ -n "${BENCH_BASELINE_TAR:-}" ]] &&
  BENCH_BASELINE_TAR="$(realpath -- "$BENCH_BASELINE_TAR")"
[[ -n "${BENCH_BASELINE_PATCH:-}" ]] &&
  BENCH_BASELINE_PATCH="$(realpath -- "$BENCH_BASELINE_PATCH")"

archive_revision() {
  local archive="$1"
  local supplied="$2"
  local revision
  revision="$(git get-tar-commit-id < "$archive" 2>/dev/null || true)"
  revision="${revision:-$supplied}"
  [[ -n "$revision" ]] ||
    fail "cannot identify archive commit; set the corresponding BENCH_*_REVISION"
  printf '%s' "$revision"
}

declare -A source_shas=()
prepare_work() {
  local target_work="$1"
  local archive="$2"
  local patch="$3"
  local log_tag="$4"
  validate_workdir "$target_work"
  mkdir -p "$target_work"
  if [[ -n "$archive" ]]; then
    # target_work was resolved and validated above; only its direct children are disposable.
    find "$target_work" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +
    tar -xf "$archive" -C "$target_work"
  else
    rsync -a --delete \
      --exclude node_modules --exclude .git --exclude .turbo --exclude .wrangler --exclude dist \
      --exclude .local --exclude .astro --exclude generated --exclude benchmark/cloudflare/results \
      "$repo/" "$target_work/"
  fi
  cp "$repo/packages/cloudflare/src/benchmark.ts" "$target_work/packages/cloudflare/src/worker.ts"
  # Pre-Astro baselines own their renderer inside createApplication. Keep the same
  # benchmark cases/fixtures, but do not import a module absent from that revision.
  if [[ ! -f "$target_work/apps/web/src/astro-render.ts" ]]; then
    sed -i '/import { renderFrontend } from "@postplan\/web\/astro-render";/d; s/, renderFrontend//g' \
      "$target_work/packages/cloudflare/src/worker.ts"
  fi
  cp \
    "$repo/packages/cloudflare/src/request-pipeline.ts" \
    "$target_work/packages/cloudflare/src/request-pipeline.ts"
  if [[ -n "$patch" ]]; then
    (cd "$target_work" && bash "$patch")
  fi
  source_shas["$log_tag"]="$(
    cd "$target_work"
    find . \
      -path ./node_modules -prune -o \
      -path ./.turbo -prune -o \
      -path ./.wrangler -prune -o \
      -path ./dist -prune -o \
      -path ./benchmark/cloudflare/results -prune -o \
      -type f -print0 |
      sort -z |
      xargs -0 sha256sum |
      sha256sum |
      cut -d' ' -f1
  )"
  (cd "$target_work" && "$bun_bin" install --frozen-lockfile --ignore-scripts) \
    > "/tmp/postplan-bench-$log_tag-install.log" 2>&1 || {
      tail -20 "/tmp/postplan-bench-$log_tag-install.log"
      exit 1
    }
  (cd "$target_work" && "$bun_bin" x --no-install turbo run cf:build --filter=@postplan/cloudflare) \
    > "/tmp/postplan-bench-$log_tag-build.log" 2>&1 || {
      tail -40 "/tmp/postplan-bench-$log_tag-build.log"
      exit 1
    }
}

worker_pids=()
start_worker() {
  local target_work="$1"
  local target_port="$2"
  local target_inspector="$3"
  local log_tag="$4"
  local state="$target_work/packages/cloudflare/.wrangler/bench"
  validate_workdir "$target_work"
  rm -rf -- "$state"
  (
    cd "$target_work/packages/cloudflare"
    exec "$bun_bin" x --no-install wrangler dev --config dist/server/wrangler.json \
      --persist-to .wrangler/bench --port "$target_port" --inspector-port "$target_inspector" \
      --local --var POSTPLAN_APPLICATION_ENABLED:true \
      --var POSTPLAN_SESSION_SECRET:local-session-only
  ) > "/tmp/postplan-bench-$log_tag-worker.log" 2>&1 &
  worker_pids+=("$!")
  for _ in $(seq 1 90); do
    grep -q "Ready on" "/tmp/postplan-bench-$log_tag-worker.log" && return
    sleep 1
  done
  tail -40 "/tmp/postplan-bench-$log_tag-worker.log"
  fail "$log_tag Worker did not start"
}

cleanup() {
  local pid
  for pid in "${worker_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

port="${BENCH_PORT:-5199}"
inspector="${BENCH_INSPECTOR_PORT:-9239}"
[[ "$port" =~ ^[0-9]+$ && "$inspector" =~ ^[0-9]+$ ]] || fail "ports must be integers"
current_revision=""
current_source=""
current_dirty=false
current_state_sha=""
if [[ -n "${BENCH_TAR:-}" ]]; then
  current_revision="$(archive_revision "$BENCH_TAR" "${BENCH_TAR_REVISION:-}")"
  current_source="archive"
else
  current_source="working-tree"
  if [[ -n "${BENCH_REVISION:-}" ]]; then
    current_revision="$BENCH_REVISION"
    current_dirty="${BENCH_DIRTY:-true}"
    current_state_sha="${BENCH_STATE_SHA256:-}"
  else
    current_revision="$(repo_git rev-parse HEAD | tr -d '\r')"
    if [[ -n "$(repo_git status --porcelain)" ]]; then
      current_dirty=true
      current_state_sha="$(
        cd "$repo"
        {
          repo_git diff --binary HEAD --
          while IFS= read -r -d '' path; do
            printf 'untracked %s\n' "$path"
            sha256sum "$path"
          done < <(repo_git ls-files --others --exclude-standard -z)
        } | sha256sum | cut -d' ' -f1
      )"
    fi
  fi
fi
current_patch_sha=""
[[ -n "${BENCH_PATCH:-}" ]] && current_patch_sha="$(sha256sum "$BENCH_PATCH" | cut -d' ' -f1)"

prepare_work "$work" "${BENCH_TAR:-}" "${BENCH_PATCH:-}" "$tag"
current_source_sha="${source_shas[$tag]}"
current_wrangler="$(
  cd "$work/packages/cloudflare"
  "$bun_bin" x --no-install wrangler --version | tail -1
)"

if [[ -n "${BENCH_BASELINE_TAR:-}" ]]; then
  baseline_revision="$(archive_revision \
    "$BENCH_BASELINE_TAR" "${BENCH_BASELINE_REVISION:-}")"
  baseline_patch_sha=""
  [[ -n "${BENCH_BASELINE_PATCH:-}" ]] &&
    baseline_patch_sha="$(sha256sum "$BENCH_BASELINE_PATCH" | cut -d' ' -f1)"
  prepare_work \
    "$baseline_work" "$BENCH_BASELINE_TAR" "${BENCH_BASELINE_PATCH:-}" "$baseline_tag"
  baseline_source_sha="${source_shas[$baseline_tag]}"
  baseline_wrangler="$(
    cd "$baseline_work/packages/cloudflare"
    "$bun_bin" x --no-install wrangler --version | tail -1
  )"
  baseline_port=$((port + 1))
  baseline_inspector=$((inspector + 1))
  start_worker "$baseline_work" "$baseline_port" "$baseline_inspector" "$baseline_tag"
  start_worker "$work" "$port" "$inspector" "$tag"
  export BENCH_TARGETS="$(printf \
    '[{"tag":"%s","baseUrl":"http://127.0.0.1:%s","inspectorUrl":"http://127.0.0.1:%s","revision":"%s","source":"archive","sourceSha256":"%s","patchSha256":"%s","wrangler":"%s"},{"tag":"%s","baseUrl":"http://127.0.0.1:%s","inspectorUrl":"http://127.0.0.1:%s","revision":"%s","source":"%s","sourceSha256":"%s","dirty":%s,"stateSha256":"%s","patchSha256":"%s","wrangler":"%s"}]' \
    "$baseline_tag" "$baseline_port" "$baseline_inspector" "$baseline_revision" \
    "$baseline_source_sha" "$baseline_patch_sha" "$baseline_wrangler" "$tag" "$port" \
    "$inspector" "$current_revision" "$current_source" "$current_source_sha" \
    "$current_dirty" "$current_state_sha" "$current_patch_sha" "$current_wrangler")"
  export BENCH_NODE_VERSION="v$NODE_VERSION"
  "$bun_bin" "$here/profile.ts" "$tag" "$cases"
  "$bun_bin" "$here/compare.ts" "$baseline_tag" "$tag"
else
  start_worker "$work" "$port" "$inspector" "$tag"
  export BENCH_PORT="$port" BENCH_INSPECTOR_PORT="$inspector"
  export BENCH_REVISION="$current_revision" BENCH_SOURCE="$current_source"
  export BENCH_SOURCE_SHA256="$current_source_sha"
  export BENCH_DIRTY="$current_dirty" BENCH_STATE_SHA256="$current_state_sha"
  export BENCH_PATCH_SHA256="$current_patch_sha"
  export BENCH_WRANGLER_VERSION="$current_wrangler" BENCH_NODE_VERSION="v$NODE_VERSION"
  "$bun_bin" "$here/profile.ts" "$tag" "$cases"
  "$bun_bin" "$here/compare.ts" "$tag"
fi
