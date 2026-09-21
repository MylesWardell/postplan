# Cloudflare CPU benchmark

Repeatable, in-process CPU benchmark for the Cloudflare Worker. Use it to compare changes before spending remote Workers Free CPU tests. Background and findings are in [the optimization investigation](../../docs/cloudflare-optimization-investigation.md#second-pass-in-process-cpu-benchmark).

## Current request paths

The benchmark builds the same Astro 7 application as production, using `apps/web/astro.config.ts` and the Cloudflare adapter. All cases first enter `handleCloudflareRequest` (gateway, application/usage guards and assets), then the shared outer Hono application:

| Cases                          | Application path                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upload`, `uploadLarge`        | Hono direct upload handler → schema/auth/rate limits → store → HTML validation and storage. Neither Astro nor the oRPC HTTP handler/plugin pipeline dispatches these requests. |
| `public`                       | Public-draft handler → store and HTML storage response. Bypasses Astro and the oRPC HTTP handler.                                                                              |
| `list`, `listMax`              | Astro `astro/hono` pipeline → `/api/[...path]` endpoint → oRPC OpenAPI Fetch handler → store.                                                                                  |
| `home`, `dashboard`, `healthz` | Astro `astro/hono` pipeline → document endpoint → Hono route. Pages render Hono JSX; dashboard loaders use direct in-process oRPC calls.                                       |

There is no React renderer, TanStack router, hydration JavaScript, or server-function request in the new frontend. Cookie authentication, exact-origin checks on form mutations, ownership checks and security headers remain part of the measured path. Direct uploads still perform their own validation, authentication, request limits and rate limits; bypassing the oRPC HTTP pipeline does not bypass those controls.

`benchmark.ts` supplies `renderFrontend` to `createApplication`, just like the production Worker. The benchmark's D1/R2/limiter substitutions below remain unchanged. The reported approximately 2 ms oRPC upload overhead motivated keeping uploads direct; this migration does not establish a new CPU saving or Workers Free acceptance result. Run interleaved comparisons before adding new figures.

## Why this setup

- **Linux only.** workerd on Windows samples at the timer tick (about 16 ms), so profiles cannot attribute CPU. Use WSL or another Linux host.
- **No simulators on the hot path.** Under `wrangler dev`, Miniflare's D1 and R2 simulators share the Worker thread and are charged to application frames. [`benchmark.ts`](../../packages/cloudflare/src/benchmark.ts) instead runs the real built application inside a Durable Object, with a D1-compatible adapter over the object's own SQLite storage, an in-memory R2 bucket and an always-allowing rate limiter.
- **Application CPU only.** [`compare.ts`](./compare.ts) applies the same native SQLite and benchmark-construction exclusions to every batch, then reports their median.

Figures are warm steady-state CPU. Deployed invocations add cold JIT, lazy compilation and binding overhead, so remote CPU is higher. Compare runs with each other; confirm important results with a bounded remote test.

## Files

| File                                   | Purpose                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `setup-linux.sh`                       | Installs pinned Bun and Node versions in the benchmark-owned user cache.                          |
| `run.sh`                               | Builds an owned disposable copy, starts Wrangler and profiles one revision or an interleaved A/B. |
| `packages/cloudflare/src/benchmark.ts` | Benchmark entry and cases; calls the production request pipeline directly.                        |
| `profile.ts`                           | Seeds `BENCH_PLANS` (58) plans, then retains every profile from a warm-up and three batches.      |
| `compare.ts`                           | Applies exclusions to every batch and prints median application CPU per request.                  |
| `inspect.ts`                           | Shows top self/inclusive functions or caller stacks for a retained profile.                       |
| `results/<tag>/`                       | Ignored raw profiles plus `metadata.json`, `summary.json` and `comparison.json`.                  |

## Steps

Run from the repository root. On Windows, prefix Linux commands with `wsl`; WSL keeps the current directory.

1. Install the toolchain once:

   ```sh
   wsl bash benchmark/cloudflare/setup-linux.sh
   ```

   The toolchains are installed under `${XDG_CACHE_HOME:-~/.cache}/postplan-benchmark/toolchains`; setup never removes or replaces `~/.node` or another user Node installation.

2. Benchmark the current working tree under a new tag (takes a few minutes):

   ```sh
   wsl bash benchmark/cloudflare/run.sh after
   wsl bash benchmark/cloudflare/run.sh after dashboard,upload   # only some cases
   ```

   If WSL cannot read a Windows linked worktree and Windows executable interop is disabled, pass the host metadata explicitly from PowerShell. The runner still hashes the exact source copy it builds:

   ```powershell
   $revision = git rev-parse HEAD
   $dirty = if (git status --porcelain) { "true" } else { "false" }
   wsl env BENCH_REVISION=$revision BENCH_DIRTY=$dirty bash benchmark/cloudflare/run.sh after
   ```

3. Benchmark a baseline commit. Export it from the host checkout, because Git inside WSL cannot resolve Windows worktree metadata:

   ```sh
   git archive -o .local/baseline.tar master
   wsl env BENCH_TAR=.local/baseline.tar bash benchmark/cloudflare/run.sh baseline
   ```

   `BENCH_TAR` and `BENCH_PATCH` accept Linux paths; relative paths resolve from the directory `run.sh` is started in.

4. Try an experiment without editing the working tree. Write a shell script, for example `.local/no-tracer.sh`:

   ```sh
   # Runs from the root of the disposable copy before building.
   sed -i 's|^import "./instrumentation";||' packages/cloudflare/src/worker.ts
   ```

   Then run it under its own tag:

   ```sh
   wsl env BENCH_PATCH=.local/no-tracer.sh bash benchmark/cloudflare/run.sh experiment
   ```

   The benchmark entry has already replaced `packages/cloudflare/src/worker.ts` when the patch runs; edit other files to change the application.

5. For the least biased comparison, profile an archive and the current tree in one interleaved run. The target order reverses between batches, so runtime drift is distributed across both revisions:

   ```powershell
   git archive -o .local/baseline.tar master
   $revision = git rev-parse HEAD
   $dirty = if (git status --porcelain) { "true" } else { "false" }
   wsl env BENCH_REVISION=$revision BENCH_DIRTY=$dirty BENCH_BASELINE_TAR=.local/baseline.tar BENCH_BASELINE_TAG=baseline bash benchmark/cloudflare/run.sh after
   ```

6. Compare tags, then inspect any retained batch profile for hot spots:

   ```sh
   bun benchmark/cloudflare/compare.ts baseline after experiment
   bun benchmark/cloudflare/inspect.ts benchmark/cloudflare/results/after/public.batch-1.cpuprofile
   bun benchmark/cloudflare/inspect.ts benchmark/cloudflare/results/after/public.batch-1.cpuprofile "is " buildSelection
   ```

Do not infer an optimization from a single run. Review each result's three batch values, repeat the interleaved comparison, and treat changes smaller than the observed run-to-run spread as noise. `uploadLarge` runs only 20 requests per batch and is especially variable.

## Cases

| Case          | Request                                                         |
| ------------- | --------------------------------------------------------------- |
| `healthz`     | `GET /healthz`                                                  |
| `home`        | `GET /`                                                         |
| `dashboard`   | `GET /dashboard` with a session cookie (first 25 plans)         |
| `list`        | `GET /api/drafts` with an API key (default page of 50)          |
| `listMax`     | `GET /api/drafts?limit=100` with an API key                     |
| `public`      | `GET /d/<id>`, 5,356-byte plan                                  |
| `upload`      | `POST /api/uploads`, 5,356 bytes, then trimmed back to the seed |
| `uploadLarge` | `POST /api/uploads`, just under 512 KiB                         |

The account is seeded with 58 plans. Set `BENCH_PLANS` to seed a larger account, for example `wsl env BENCH_PLANS=120 bash benchmark/cloudflare/run.sh after list,listMax,dashboard`. `run.sh` copies the current benchmark entry into every target, so archived baselines seed the same count and accept `listMax`; revisions without list pagination ignore `limit` and return every plan. For pre-Astro archives, the runner removes only the new renderer import/option from the copied benchmark entry: those revisions create their own renderer internally. This keeps the baseline on its original framework while sharing the cases and fixtures.

To add a case, add a request factory to `packages/cloudflare/src/benchmark.ts` and a batch size to `PLAN` in `profile.ts`.

## Keeping it valid

- Production and benchmark requests both call `packages/cloudflare/src/request-pipeline.ts`; keep request routing, middleware, logging and error handling in that shared function.
- When migrations are added, import and apply them in `setup()`.
- Disposable copies must be children of `${XDG_CACHE_HOME:-~/.cache}/postplan-benchmark/workdirs`. `run.sh` resolves and rejects empty paths, roots, home/repository paths, escapes through symlinks, and paths outside that owned parent before cleanup. Never deploy a benchmark build.
- Check the printed statuses: a case returning errors measures a failure path.
- Ports 5199 and 9239 must be free; override with `BENCH_PORT` and `BENCH_INSPECTOR_PORT`.
- Keep `metadata.json`, `summary.json`, `comparison.json` and every `.cpuprofile` together when sharing a result. They record the commit, exact built-source hash, dirty/patch state, tool versions, scenario order and batch execution order.

## Results history

These measurements predate the Astro/Hono JSX rewrite and direct Hono uploads. They describe the recorded revisions, not the current request paths. No Astro migration CPU results have been recorded here.

Application CPU per request in milliseconds. This 2026-09-17 parity run interleaved the archived application at `7266f84` with the issue #22 working tree at the same application commit. The comparison applies exclusions independently to all three raw profiles and reports their median.

| Case          | Archive `7266f84` | Issue #22 tree |
| ------------- | ----------------: | -------------: |
| `healthz`     |              0.76 |           0.80 |
| `home`        |              0.87 |           0.76 |
| `dashboard`   |              2.22 |           2.49 |
| `list`        |              6.03 |           6.04 |
| `public`      |              1.93 |           2.08 |
| `upload`      |              7.60 |           7.26 |
| `uploadLarge` |             18.18 |          17.35 |

The application behavior is intentionally equivalent across these two targets; the spread is measurement noise, not an optimization result. The previous staged table used only the first profile despite running three batches and has been removed. Add future columns only from `comparison.json` produced by the corrected method, and include the result bundle's commit or patch identity.
