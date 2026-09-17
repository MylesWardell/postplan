# Cloudflare CPU benchmark

Repeatable, in-process CPU benchmark for the Cloudflare Worker. Use it to compare changes before spending remote Workers Free CPU tests. Background and findings are in [the optimization investigation](../../docs/cloudflare-optimization-investigation.md#second-pass-in-process-cpu-benchmark).

## Why this setup

- **Linux only.** workerd on Windows samples at the timer tick (about 16 ms), so profiles cannot attribute CPU. Use WSL or another Linux host.
- **No simulators on the hot path.** Under `wrangler dev`, Miniflare's D1 and R2 simulators share the Worker thread and are charged to application frames. [`worker.ts`](./worker.ts) instead runs the real built application inside a Durable Object, with a D1-compatible adapter over the object's own SQLite storage, an in-memory R2 bucket and an always-allowing rate limiter.
- **Application CPU only.** [`compare.mjs`](./compare.mjs) excludes native SQLite execution (standing in for remote D1) and the benchmark's request construction.

Figures are warm steady-state CPU. Deployed invocations add cold JIT, lazy compilation and binding overhead, so remote CPU is higher. Compare runs with each other; confirm important results with a bounded remote test.

## Files

| File             | Purpose                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `setup-linux.sh` | Installs Bun 1.4.2 and Node 22 into `~/.bun` and `~/.node`.                                   |
| `run.sh`         | Copies the repository, swaps in the benchmark entry, builds, starts Wrangler and profiles.    |
| `worker.ts`      | Benchmark entry and cases. Mirrors the enabled path of `packages/cloudflare/src/worker.ts`.   |
| `profile.mjs`    | Seeds 58 plans, then profiles each case: one warm-up and three batches through the inspector. |
| `compare.mjs`    | Prints application CPU per request for one or more result tags.                               |
| `inspect.mjs`    | Top self/inclusive functions for a profile, or caller stacks for named functions.             |
| `results/<tag>/` | Ignored output: `summary.json` and the first batch's `.cpuprofile` for each case.             |

## Steps

Run from the repository root. On Windows, prefix Linux commands with `wsl`; WSL keeps the current directory.

1. Install the toolchain once:

   ```sh
   wsl bash benchmark/cloudflare/setup-linux.sh
   ```

2. Benchmark the current working tree under a new tag (takes a few minutes):

   ```sh
   wsl bash benchmark/cloudflare/run.sh after
   wsl bash benchmark/cloudflare/run.sh after dashboard,upload   # only some cases
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

5. Compare tags, then look for hot spots:

   ```sh
   node benchmark/cloudflare/compare.mjs baseline after experiment
   node benchmark/cloudflare/inspect.mjs benchmark/cloudflare/results/after/public.cpuprofile
   node benchmark/cloudflare/inspect.mjs benchmark/cloudflare/results/after/public.cpuprofile "is " buildSelection
   ```

Treat differences under about 10% as noise. `uploadLarge` runs only 20 requests per batch and is the noisiest case.

## Cases

| Case          | Request                                                         |
| ------------- | --------------------------------------------------------------- |
| `healthz`     | `GET /healthz`                                                  |
| `home`        | `GET /`                                                         |
| `dashboard`   | `GET /dashboard` with a session cookie, 58 plans                |
| `list`        | `GET /api/drafts` with an API key, 58 plans                     |
| `public`      | `GET /d/<id>`, 5,356-byte plan                                  |
| `upload`      | `POST /api/uploads`, 5,356 bytes, then trimmed back to 58 plans |
| `uploadLarge` | `POST /api/uploads`, just under 512 KiB                         |

To add a case, add a request factory to `cases` in `worker.ts` and a batch size to `PLAN` in `profile.mjs`.

## Keeping it valid

- When `packages/cloudflare/src/worker.ts` changes its request handling, mirror the change in the handler returned by `setup()` in `worker.ts`.
- When migrations are added, import and apply them in `setup()`.
- The copy is disposable (`BENCH_WORKDIR`, default `~/postplan-bench`). Never deploy its build.
- Check the printed statuses: a case returning errors measures a failure path.
- Ports 5199 and 9239 must be free; override with `BENCH_PORT` and `BENCH_INSPECTOR_PORT`.

## Results history

Application CPU per request in milliseconds, from `compare.mjs`. Each column includes the changes to its left.

| Case          | Baseline `6613a0f` | String SSR | + oRPC tracer off | + prepared queries |
| ------------- | -----------------: | ---------: | ----------------: | -----------------: |
| `healthz`     |               1.29 |       1.16 |              0.55 |               0.62 |
| `home`        |               0.94 |       0.74 |              0.85 |               0.84 |
| `dashboard`   |               6.39 |       5.81 |              2.53 |               2.67 |
| `list`        |              10.59 |       9.78 |              6.21 |               5.66 |
| `public`      |               4.57 |       4.56 |              3.75 |               1.93 |
| `upload`      |              18.59 |      18.71 |              7.63 |               7.94 |
| `uploadLarge` |              23.46 |      23.44 |             16.85 |              20.25 |

Add a column when a change is measured, and note the commit or patch it represents.
