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

## Cleanup and remaining work

Both preflight and postflight account checks retain Workers Free and private Standard R2. The run wrote nine temporary objects (1,785,540 bytes) and made 30 application R2 reads. All nine objects were deleted and verified absent. The new test key was revoked, 106 synthetic version rows removed, and draft tombstones retained. There are no active drafts or stored version rows. Lifetime counters now show 18 writes, 58 reads and 3,571,080 reserved bytes across both runs; no allowance was reset. All six stop controls passed and the deployed Worker remains stopped with ingress disabled.

To pursue reliable Free hosting, the next substantial changes are pagination/client rendering for the dashboard and a cheaper upload-validation design. A replacement parser must preserve browser-compatible handling of malformed HTML, blocked elements, URL attributes, scripts, noscript and nesting limits. Moving validation only into the CLI would make it bypassable and is not an acceptable optimization. These larger changes were not substituted for the current validated behavior in this pass.
