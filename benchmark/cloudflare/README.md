# Cloudflare CPU benchmark

Warm local application CPU for the Astro/Hono Worker. The harness uses Durable Object SQLite in place of D1, an in-memory R2 bucket and a stub rate limiter. Results exclude native SQLite and request-construction work; they do not measure deployed CPU or cold starts.

## Latest recorded results

2026-09-22, revision `ac1f7ea`, latest run, 58 seeded plans. Each value is the median of three batch averages. Reads returned 200 and uploads returned 201.

| Case                        | CPU per request (ms) |
| --------------------------- | -------------------: |
| Health check                |                 0.60 |
| Homepage                    |                 0.36 |
| Dashboard (25 drafts)       |                 1.26 |
| Draft list (limit 50)       |                 1.49 |
| Draft list (limit 100)      |                 1.56 |
| Public HTML (5,356 bytes)   |                 2.44 |
| Upload (5,356 bytes)        |                 5.63 |
| Upload (just under 512 KiB) |                16.39 |

## Run

From the repository root on Linux (prefix the `bash` commands with `wsl` on Windows):

```sh
bash benchmark/cloudflare/setup-linux.sh
bash benchmark/cloudflare/run.sh current
bun benchmark/cloudflare/compare.ts current
```

Use a new tag for each run. To run selected cases, append a comma-separated list, for example `run.sh current dashboard,upload`. `BENCH_PLANS=120` changes the seed count.

Profiles and metadata are saved in the ignored `benchmark/cloudflare/results/<tag>/` directory. Check response statuses and repeat runs before drawing conclusions. Windows profiling is too coarse; use WSL.

If WSL cannot resolve a Windows worktree's Git metadata, run from PowerShell:

```powershell
$revision = git rev-parse HEAD
$dirty = if (git status --porcelain) { "true" } else { "false" }
wsl env BENCH_REVISION=$revision BENCH_DIRTY=$dirty bash benchmark/cloudflare/run.sh current
```
