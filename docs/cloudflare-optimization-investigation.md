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

## Cleanup and remaining work

Both preflight and postflight account checks retain Workers Free and private Standard R2. The run wrote nine temporary objects (1,785,540 bytes) and made 30 application R2 reads. All nine objects were deleted and verified absent. The new test key was revoked, 106 synthetic version rows removed, and draft tombstones retained. There are no active drafts or stored version rows. Lifetime counters now show 18 writes, 58 reads and 3,571,080 reserved bytes across both runs; no allowance was reset. All six stop controls passed and the deployed Worker remains stopped with ingress disabled.

To pursue reliable Free hosting, the next substantial changes are pagination/client rendering for the dashboard and a cheaper upload-validation design. A replacement parser must preserve browser-compatible handling of malformed HTML, blocked elements, URL attributes, scripts, noscript and nesting limits. Moving validation only into the CLI would make it bypassable and is not an acceptable optimization. These larger changes were not substituted for the current validated behavior in this pass.
