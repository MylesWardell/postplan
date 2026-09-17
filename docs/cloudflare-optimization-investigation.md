# Cloudflare optimization investigation

The first optimization pass reduces avoidable work, but **the application still does not reliably fit Workers Free's 10 ms CPU allowance**. The package cleanup is complete; permanent regression tests remain tracked and all one-off probes/profilers are outside the package in gitignored `.local/cloudflare/`.

## Changes retained

- Reuse one immutable UTC `Intl.DateTimeFormat` instead of constructing a formatter for each dashboard date.
- Dispatch `/api` requests directly to the existing oRPC handler, preserving authentication, CORS, body limits, error handling and HTML security headers. Page rendering and server functions continue through TanStack Start, including its server-function CSRF protection.
- Check the Cloudflare stop latch and budget initialization in one D1 query. R2 operations still check the latch inside their atomic reservations.
- Reuse a single request-body chunk instead of allocating and copying a second buffer.
- Reject oversized UTF-8 HTML before constructing a parse tree. Accepted HTML still passes the unchanged parser and validation rules.

The local workerd profile of 1,160 date formats sampled roughly 44 ms of execution with new formatters versus 3 ms with a reused formatter. This is an isolated local comparison, not deployed CPU timing. Profiling maximum-sized HTML showed substantial time in parse5 tokenization, text emission, tree construction and garbage collection. The complete application profile also crosses native I/O boundaries, so its elapsed samples must not be presented as Cloudflare-billed CPU.

## Remote comparison

The optimized runtime at commit `61f815d` was deployed to the same Workers Free service as version `9f352233-4b87-4279-bfdd-d26d947d78fd`. A separate synthetic account held 58 visible plans and 100 versions during the dashboard/list tests. The database also retained 58 deleted tombstones from the baseline test; those were outside this account. HTML sizes, upload repetitions and sequential Sydney requests matched the earlier experiment.

| Workload                    | Previous median | New median | New range | New samples over 10 ms |
| --------------------------- | --------------: | ---------: | --------: | ---------------------: |
| Dashboard, 58 plans         |           25 ms |    20.5 ms |  15–52 ms |                    8/8 |
| Homepage                    |           15 ms |      15 ms |   4–49 ms |                    4/8 |
| Authenticated plan-list API |           10 ms |    10.5 ms |   7–35 ms |                    4/8 |
| Upload, 5,356 bytes         |           48 ms |      29 ms |  13–46 ms |                    3/3 |
| Upload, 64 KiB              |           34 ms |      31 ms |  30–81 ms |                    3/3 |
| Upload, 512 KiB             |          122 ms |      88 ms | 79–122 ms |                    3/3 |
| Public HTML, 5,356 bytes    |            4 ms |       3 ms |    2–5 ms |                   0/10 |
| Public HTML, 64 KiB         |            4 ms |       2 ms |    2–5 ms |                    0/9 |
| Public HTML, 512 KiB        |            3 ms |       3 ms |    2–6 ms |                   0/10 |

These small sequential samples have uncontrolled isolate/JIT placement. Lower medians are observations, not a proven speedup attributable to an individual change; some maxima increased. Every measured dashboard render and upload still exceeded the allowance. All intended HTTP requests completed successfully and observed invocation outcomes were `ok`; burst tolerance is not a dependable operating target. [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

There were 92 HTTP attempts: 90 application requests, one successful stopped-state readiness check and one edge 404 during exposure propagation. Logs provided 87 application CPU measurements plus the stopped-state check. Two account API responses and one 64 KiB public read had no matching invocation log; their CPU values remain unknown. Matching used the exact deployed version, request index, case and test time window; Cloudflare redacted the run marker in this run. The [sanitized measurements](./cloudflare-cpu-optimized-results.json) retain missing values rather than treating them as zero. The original [baseline report](./cloudflare-cpu-test.md) remains available.

## Package structure and validation

`packages/cloudflare/src` contains runtime code; `deploy` contains repeatable initialization and SQL; `test` contains permanent workerd/HTTP/Python regression tests; `usage` contains the operational monitor, policy and GraphQL query. Wrangler/Vite/Vitest/TypeScript configuration stays at the package root. The experimental probe endpoint, probe budget implementation and one-off HTTP script were removed from tracked runtime code. Historical D1 counters were preserved.

The new configuration names are `POSTPLAN_RATE_LIMIT_SECRET` and `POSTPLAN_LOCAL`. The rate-limit secret retained its previous value for this deployment, preserving subject identities. CLI credentials, profiler scripts, raw logs and experimental configurations are ignored; none are imported by runtime code.

Validation passed: repository checks, Cloudflare build/typecheck, 16 permanent workerd tests, 15 usage-guard tests, built-Worker HTTP acceptance, and GitHub CI including DynamoDB and all Docker builds. Regression coverage includes HTML security policy, oversized Unicode, API documentation CSP, compressed requests, CORS, authentication, storage concurrency and reinitialization preserving consumed budgets. Three tests dedicated solely to the removed probe endpoint were removed with it.

## Second pass: in-process CPU benchmark

### Measurement correction

Local CPU profiles captured on Windows are not usable for attribution. workerd sampled at the Windows timer tick: a 40-request `/healthz` profile held 37 samples with a median interval of 16 ms, so every request appeared to cost about 15 ms regardless of work. The earlier upload profiles came from the same environment; their function-level percentages should not guide optimization. Linux profiles of `wrangler dev` were also misleading because Miniflare runs the D1/R2 simulators on the same thread, attributing simulator work to application frames (the plan-list API appeared to cost 41 ms locally against 10 ms remotely).

The replacement benchmark runs in WSL. A Durable Object executes the real built application in a loop against a D1-compatible adapter over its own SQLite storage and an in-memory R2 bucket, so the profiled isolate contains only application work plus native SQLite calls. Each case runs a warm-up then three profiled batches. Every raw profile is retained, SQLite and benchmark-construction frames are excluded independently from each batch, and the published value is their median. Interleaved A/B mode reverses target order between batches to distribute runtime drift. The benchmark entry calls the production request pipeline directly, while remaining outside the deployed entry graph. Scripts and rerun steps are in [`benchmark/cloudflare/`](../benchmark/cloudflare/README.md).

These are warm steady-state figures. Deployed invocations include cold JIT, lazy compilation and Cloudflare's binding overhead, so absolute values are lower than remote CPU measurements. Use them to compare changes, not to predict Free-plan compliance.

### Results so far

Application CPU per request for the corrected 2026-09-17 interleaved parity run, 58-plan account, milliseconds:

| Case                     | Archive `7266f84` | Issue #22 tree |
| ------------------------ | ----------------: | -------------: |
| `/healthz`               |              0.76 |           0.80 |
| Homepage                 |              0.87 |           0.76 |
| Dashboard                |              2.22 |           2.49 |
| Authenticated plan list  |              6.03 |           6.04 |
| Public HTML, 5,356 bytes |              1.93 |           2.08 |
| Upload, 5,356 bytes      |              7.60 |           7.26 |
| Upload, 512 KiB          |             18.18 |          17.35 |

Both targets use equivalent application behavior; this is a parity and methodology check, not an optimization comparison. The prior staged table was derived from the first profile only, despite collecting three batches, so its percentage claims are withdrawn. Tracing, string rendering and prepared-query changes remain in the code, but their individual effects must be remeasured from interleaved archives before drawing a performance conclusion.

Validation for this pass: format, lint, Cloudflare typecheck, 16 workerd tests, web, Lambda and store-drizzle tests, and built-Worker HTTP acceptance against local D1. The acceptance run exercises reused prepared statements across many requests, including versioned reads, key revocation and deletion. Reuse against remote D1, the full repository check (DynamoDB and Docker) and a repeated remote CPU comparison have not been run.

### Previously observed hot spots

These are investigation candidates from the superseded first-profile analysis, not corrected comparison results.

- **Duplicate Zod validation.** Store calls go through an in-process oRPC router, validating input and output a second time after the API contract. Zod 4 cannot use its JIT in Workers because code generation is disallowed. Measured separately in Node (jitless), validating 58 plans costs about 0.04 ms per pass, so this is a small win.
- **Public URL construction.** `getDraftPublicUrl`/`getDraftRawUrl` reparse the configured base URL twice per listed plan, and `hostDraftId` reparses it per request.
- **Request body buffering.** `boundedBody` appeared prominently in the earlier 512 KiB profile. A `Content-Length` fast path using `arrayBuffer()` may help; streaming limits must remain for chunked bodies.
- **OpenAPI handler plumbing.** The plan-list API costs about 3 ms more than the dashboard, which renders the same list through the in-process client. Request conversion, header normalization, evlog, CORS and coercion plugins all appear in the profile.

Rejected: replacing `node:crypto` HMAC/SHA-256. The Windows profile blamed session HMAC verification for about 3 ms per dashboard request, but a workerd micro-benchmark measured about 30 µs per `createHmac` call and 19 µs for Web Crypto.

## Third pass: logging, parser and R2 streaming

Issue #20 identified three follow-up candidates. Two are safe to retain; the parser replacement is not.

### Cloudflare logging

The Cloudflare application now disables oRPC's always-on Evlog handler. Other runtimes retain the previous default. The Worker emits one small JSON record only for failed requests, containing the method, path, status, request ID and client IP. It deliberately omits headers, credentials, query strings and bodies. This keeps failure and abuse-investigation metadata without formatting a full success event on every request; Cloudflare invocation logs still record request outcome and billed CPU.

Corrected WSL A/B results, milliseconds of application CPU per request:

| Case                     | Before | Error-only logging + R2 stream | Change |
| ------------------------ | -----: | -----------------------------: | -----: |
| Authenticated plan list  |   6.19 |                           4.08 |   -34% |
| Upload, 5,356 bytes      |   8.34 |                           6.77 |   -19% |
| Upload, 512 KiB          |  17.49 |                          18.02 |    +3% |
| Public HTML, 5,356 bytes |   2.17 |                           2.15 |    -1% |

The interleaved run supports retaining the logging change for ordinary API traffic. It does not improve the large-upload parse path, and the 3% increase there is within run-to-run noise. Large uploads remain well above the 10 ms target.

### Parser prototype

A streaming SAX-tokenizer policy prototype reduced 512 KiB validation CPU from 19.94 ms to 14.18 ms (29%) locally, but it failed the security-equivalence gate and was removed. It passed the targeted application corpus and did not accept any tree-rejected document in 1,959 upstream HTML tree-construction fixtures. Deterministic malformed-input fuzzing then found 244 documents rejected by the production tree policy but accepted by the tokenizer, and 148 documents where the production parser found a script but the tokenizer did not; 357 unique inputs had at least one unsafe mismatch.

The failures come from treating token events as if they were the browser's constructed tree, especially around malformed markup, insertion modes, templates and foreign content. A native `HTMLRewriter` adapter would remove JavaScript parse5 work and preserve streaming, but its selector callbacks do not by themselves prove equivalent browser tree construction or the current nesting policy. It remains a possible research direction only if it is exercised against the same differential corpus and fuzz gate. The production parse5 policy is unchanged.

### Public R2 reads

The R2 adapter now returns `R2ObjectBody.body` directly to `Response` instead of awaiting `text()` and materializing the entire object. This preserves the existing 512 KiB stored-object check and response headers. A deployed A/B/A test read the same private 473,803-byte R2 object 20 times per version from Sydney; every response was `200`, exactly 473,803 bytes and had an `ok` invocation outcome.

| Deployed implementation | Worker version                         | CPU median | CPU mean | CPU range |
| ----------------------- | -------------------------------------- | ---------: | -------: | --------: |
| Stream A                | `4ea9bbbf-82e9-4547-a7c6-8fed16efe375` |       3 ms |  5.75 ms |   2–21 ms |
| Buffered control        | `d94717b1-1a78-429e-b65c-710c795bce29` |       4 ms |  6.35 ms |   3–22 ms |
| Stream C                | `d314c825-f27b-4a48-bc90-49031dd7854d` |       3 ms |  4.20 ms |   2–18 ms |

Cloudflare reports whole-millisecond CPU here and the small samples contain isolate/JIT outliers. The result validates the streamed response and suggests a modest reduction in memory and CPU; it is not a precise performance estimate. The final deployed version is Stream C.

The remote audit also exposed two newly reported R2 analytics action names that were not classified by the guard. `GetBucketSippyConfiguration` and `GetBucketNotificationConfiguration` are now conservatively counted as Class A until Cloudflare's pricing table classifies them. The temporary D1 rows and R2 object were deleted and verified absent. The persistent stop is latched, all six stop controls passed, and `workers.dev` returns the expected edge 404.

## Cleanup and remaining work

Both preflight and postflight account checks retain Workers Free and private Standard R2. The run wrote nine temporary objects (1,785,540 bytes) and made 30 application R2 reads. All nine objects were deleted and verified absent. The new test key was revoked, 106 synthetic version rows removed, and draft tombstones retained. There are no active drafts or stored version rows. Lifetime counters now show 18 writes, 58 reads and 3,571,080 reserved bytes across both runs; no allowance was reset. All six stop controls passed and the deployed Worker remains stopped with ingress disabled.

To pursue reliable Free hosting, the next substantial changes are pagination/client rendering for the dashboard and a cheaper upload-validation design. A replacement parser must preserve browser-compatible handling of malformed HTML, blocked elements, URL attributes, scripts, noscript and nesting limits. Moving validation only into the CLI would make it bypassable and is not an acceptable optimization. These larger changes were not substituted for the current validated behavior in this pass.

## Fourth pass: bounded lists and remaining CPU actions

Issue #29 follow-up. Baseline `59ab3ee` (master after #28); candidate is this branch. All figures are warm, interleaved WSL benchmark medians of application CPU per request (ms), subject to the limits described above. Nothing in this pass was deployed or measured remotely.

### Changes retained

- **Bounded draft list.** `drafts.list` takes `limit` (default 50, maximum 100), an opaque keyset `cursor` over `(updatedAt, id)`, `q` and `status`, and returns `nextCursor`. `drafts.totals` supplies the account-wide counts the dashboard previously derived from the full list. Ownership, deleted-draft exclusion and newest-first ordering are unchanged; ties now order by id so pages are stable. The CLI follows every page.
- **Dashboard.** Renders 25 drafts per page with server-side search/status filters and first/next links. Its loader serializes only rendered fields, so public/raw URLs, repository owner/host and creation dates no longer enter the SSR payload. A stale cursor falls back to the first page.
- **SQL list query.** A correlated `draft_id`-indexed version count replaces a subquery that grouped every account's versions on each list, reducing D1 rows read as the table grows. List URLs parse the configured base URL once per page instead of twice per plan; a test checks the builder against the per-draft functions for wildcard, port, credential, trailing-path and unsafe-id inputs.
- **API-key use writes.** The SQL store records `last_used_at` at most once a minute, matching the existing DynamoDB policy, instead of issuing a D1 write for every authenticated request.

Search semantics: `q` is case-insensitive for ASCII only, matching SQLite `lower()`; DynamoDB uses the same folding. The previous in-page JavaScript filter also folded non-ASCII letters.

### Results

58 plans, two interleaved runs against `59ab3ee`:

| Case                     | Run 1 master | Run 1 candidate | Run 2 master | Run 2 candidate |
| ------------------------ | -----------: | --------------: | -----------: | --------------: |
| `/healthz`               |         0.85 |            0.78 |         0.61 |            0.56 |
| Homepage                 |         0.73 |            0.77 |         0.62 |            0.63 |
| Dashboard                |         2.30 |            2.33 |         2.01 |            1.77 |
| Plan list (page of 50)   |         6.16 |            1.66 |         4.00 |            1.21 |
| Public HTML, 5,356 bytes |         2.12 |            2.03 |         1.90 |            2.15 |
| Upload, 5,356 bytes      |         6.49 |            5.70 |         6.39 |            5.70 |
| Upload, 512 KiB          |        17.64 |           16.53 |        15.22 |           15.39 |

Unchanged code paths (`public`, `home`) moved by up to 13% between targets, so only the list and small-upload improvements repeat above noise. An interleaved attribution run of the candidate against itself with a `last_used_at` write on every request measured list 1.18 vs 3.82 and upload 5.50 vs 6.37: most of the API gain is the avoided write. Part of that cost is the benchmark's D1 adapter, so the remote saving is a D1 round trip and write rather than a proven CPU figure.

120 plans (`BENCH_PLANS=120`), one interleaved run; master returns every plan for both list cases:

| Case                           | Master | Candidate |
| ------------------------------ | -----: | --------: |
| Dashboard (candidate: 25 rows) |   3.06 |      1.94 |
| Plan list (candidate: 50)      |   4.64 |      1.20 |
| Plan list, `limit=100`         |   4.08 |      1.45 |

The dashboard no longer grows with account size; at 58 plans its change is within noise because the page gained a totals query.

### Upload validation (priority 1)

No parser replacement was adopted; production validation is unchanged. A Node micro-benchmark of the 512 KiB fixture measured parse5 tokenization alone at 6.3 ms, full `parse` at 10.4 ms and the complete policy at 10.9 ms. Any design that constructs a browser-equivalent tree retains the tokenizer cost, and the small-upload request already costs about 6 ms, so a JavaScript parser cannot bring 512 KiB uploads under 10 ms even with free tree construction.

Two tree-adapter variants were measured and rejected. Dropping text nodes saved 2.5 ms but changes the nesting-depth result for text at the depth limit, because adoption-agency moves cannot carry a per-element flag. Keeping text nodes without concatenating their values saved about 1.2 ms (about 7% of the request), below the 10% noise threshold, and would still need separate handling for `<title>` text including foreign-content descendants. `HTMLRewriter` remains unsuitable without tree construction (see the third pass). A WASM html5ever build is the remaining security-equivalent candidate; it was not prototyped because its per-isolate compile cost needs the cold measurement below first.

### Cold path and bundle (priority 3)

The built Worker is 2.0 MB: `index.js` is 866 KB and statically imports 13 chunks at startup, including the 474 KB React DOM server chunk and the 283 KB router chunk; the Start manifest, router, start and plugin-adapter chunks, and the page routes behind the router, load lazily. OpenAPI generation already runs only for `/api/spec.json` and `/api`. No bundle change was made: warm local profiles cannot measure module evaluation or first-request compilation, and deferring code without that measurement risks moving cost onto the first request. A cold-isolate harness (fresh workerd per sample, profiler attached before the first request) is still required.

### Not done

- Remote comparison, deployed-Worker validation, D1/R2 fixture cleanup and stop-control re-latching: no deployment was made, and public ingress remains disabled.
- Differential corpus and 20,000-document fuzz runs: no parser candidate reached that gate.
- Profile-gated items (per-request URL and `Request` reconstruction, OpenAPI plugin removal): remaining gateway URL parsing measured about 0.1 ms per request, below the promotion threshold.
