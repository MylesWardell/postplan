# Cloudflare CPU benchmark

Warm local application CPU for the Astro/Hono Worker. The harness uses Durable Object SQLite in place of D1, an in-memory R2 bucket and a stub rate limiter. Results exclude native SQLite and request-construction work; they do not measure deployed CPU or cold starts.

## Upload admission comparison (2026-09-22)

Compared master `0c8aee7` with the admission fix after merging master (`86bb02c`, plus the benchmark-only changes in this PR). Both revisions use the same updated harness. Two independent runs alternate baseline/fix order across three batches per case, with 58 seeded plans and a 100 microsecond sampling interval. Runtime: WSL Linux x64, Bun 1.4.2, Node 22.20.0, Wrangler 4.135.0.

Application CPU in milliseconds per request; each cell is the median of three batch averages:

| Case                  | Master A | Fix A | Master B | Fix B |
| --------------------- | -------: | ----: | -------: | ----: |
| `upload`              |     6.20 |  6.46 |     5.84 |  6.23 |
| `uploadLarge`         |    21.23 | 20.89 |    20.95 | 21.53 |
| `uploadGzip`          |    20.01 | 17.56 |    18.38 | 18.15 |
| `uploadMalformed`     |     4.39 |  4.51 |     4.06 |  3.98 |
| `uploadMalformedGzip` |     7.37 |  7.51 |     7.46 |  7.48 |
| `uploadInvalidGzip`   |     3.66 |  3.51 |     4.22 |  4.22 |
| `uploadUnauthorized`  |     4.12 |  4.47 |     4.37 |  4.43 |
| `uploadIpLimited`     |     4.33 |  4.17 |     5.19 |  4.16 |
| `uploadKeyLimited`    |     3.91 |  3.48 |     4.43 |  3.23 |

Small valid uploads measured 0.26–0.39 ms more CPU (about 4–7%) in these runs. Large uncompressed uploads varied in both directions, while gzip uploads and exhausted IP/key allowances used less CPU in both runs. These samples do not establish a statistically significant latency change or a production CPU guarantee. The fix adds no authentication or limiter calls to accepted uploads; it changes their order. Master already rejects missing credentials before body processing, so the unauthorized case measures the added IP admission check, not newly avoided decompression.

Malformed authenticated requests now invoke both limiters, and missing credentials invoke the IP limiter. The stub includes the real limiter-name hashing but excludes remote Durable Object latency and persistent writes, so this comparison cannot quantify that additional production cost. It also does not exercise a sustained attack until its allowance is exhausted: denied cases start with a deterministic exhausted allowance.

[Recorded per-batch CPU, status counts, source hashes and runtime metadata](./upload-admission-results.json). Raw profiles remain in ignored `results/admission-{master,fix}-{a,b}/`. Measured fix trees are marked dirty because the benchmark changes were not committed during measurement; source hashes identify the exact disposable trees.

### Admission cases

| Case                  | Fixture                                               | Expected status | Requests per batch |
| --------------------- | ----------------------------------------------------- | --------------: | -----------------: |
| `upload`              | 5,356-byte HTML                                       |             201 |                150 |
| `uploadLarge`         | HTML just under 512 KiB                               |             201 |                 20 |
| `uploadGzip`          | Gzip of the large valid upload                        |             201 |                 20 |
| `uploadMalformed`     | Truncated JSON                                        |             400 |                150 |
| `uploadMalformedGzip` | Gzip of 512 KiB whitespace followed by truncated JSON |             400 |                 20 |
| `uploadInvalidGzip`   | Invalid gzip bytes                                    |             400 |                150 |
| `uploadUnauthorized`  | Large valid gzip body, no bearer credentials          |             401 |                150 |
| `uploadIpLimited`     | Large valid gzip body, IP allowance exhausted         |             429 |                150 |
| `uploadKeyLimited`    | Large valid gzip body, key allowance exhausted        |             429 |                150 |

Compression happens once before profiling. Warmups use one third of the batch size, rounded up. Every warmup and profiled batch must return exactly the expected status/count; an unexpected success, failure, or incomplete batch aborts the run. Existing read cases expect 200. The benchmark Worker is local-only and must never be deployed.

To repeat the interleaved comparison from Linux/WSL with the updated harness:

```sh
git archive 0c8aee7add0acb6dbf685321f29c9d35be7f70ae -o /tmp/postplan-admission-master.tar
BENCH_BASELINE_TAR=/tmp/postplan-admission-master.tar \
  BENCH_BASELINE_TAG=admission-master-new \
  bash benchmark/cloudflare/run.sh admission-fix-new \
  upload,uploadLarge,uploadGzip,uploadMalformed,uploadMalformedGzip,uploadInvalidGzip,uploadUnauthorized,uploadIpLimited,uploadKeyLimited
```

Use new tags for a second independent run. For Windows worktrees, create the archive with Windows Git and supply the WSL archive path; use the `BENCH_REVISION`/`BENCH_DIRTY` override below if Git interop is unavailable.

## Historical full-suite results

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
