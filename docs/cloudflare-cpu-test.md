# Workers Free CPU test

**Result: the current application does not reliably fit the 10 ms CPU allowance.** All eight renders of the 58-plan dashboard and all nine uploads exceeded it. Low daily traffic provides ample request/storage headroom, but does not reduce CPU work per request.

Tested 14 September 2026 on the existing personal-account `postplan-clone` Worker, Workers Free, version `f29190e2-2e2b-45f9-942f-0ff4eda7873e`, built from commit `7c81b8cb038ce0cd5e7eab3e3e376a1b8a91ef76`. Measurements come from Cloudflare Workers Observability invocation logs (`$workers.cpuTimeMs`), matched to unique request markers and the exact deployed version. The [sanitized per-request results](./cloudflare-cpu-results.json) preserve the evidence without credentials or content.

## Results

| Route/workload                        | Samples | Median CPU |     Range | Over 10 ms |
| ------------------------------------- | ------: | ---------: | --------: | ---------: |
| Homepage SSR                          |       8 |      15 ms |   4–50 ms |        4/8 |
| Dashboard, 58 plans / 100 versions    |       8 |      25 ms |  15–38 ms |        8/8 |
| Authenticated plan-list API, 58 plans |       8 |      10 ms |   7–16 ms |        4/8 |
| Dashboard plan details                |       8 |     6.5 ms |   5–11 ms |        1/8 |
| Authenticated account API             |       8 |       7 ms |    4–9 ms |        0/8 |
| Public HTML, 5,356 bytes              |       8 |       4 ms |   3–15 ms |        1/8 |
| Public HTML, 64 KiB                   |      10 |       4 ms |    2–6 ms |       0/10 |
| Public HTML, 512 KiB                  |      10 |       3 ms |    3–4 ms |       0/10 |
| Upload, 5,356 bytes                   |       3 |      48 ms |  14–54 ms |        3/3 |
| Upload, 64 KiB                        |       3 |      34 ms |  33–70 ms |        3/3 |
| Upload, 512 KiB                       |       3 |     122 ms | 65–132 ms |        3/3 |
| Health                                |       7 |       2 ms |    2–3 ms |        0/7 |
| Reject unauthenticated upload         |       3 |       5 ms |    4–6 ms |        0/3 |

All measured intended application requests completed with their expected HTTP status and invocation outcome `ok`; no `exceededCpu` termination was observed. **That does not constitute a Free-tier pass.** Cloudflare documents temporary isolate flexibility for occasional overages and termination when CPU limits are hit consistently. This bounded sample demonstrates repeated overages without deliberately escalating into a load test. [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

## Method and limits

The run made 112 HTTP attempts in total, below the planned 150-request bound. Ninety-six attempts had matching invocation CPU logs; the results table includes 87 intended application responses. The remainder were two stopped-state readiness responses and seven responses to an initially incorrect detail-route URL. Sixteen edge 404 responses had no matching invocation log, mostly while workers.dev exposure propagated; they are excluded from CPU statistics. The corrected `/dashboard/drafts/:id` route subsequently returned eight successful responses.

Fixtures were generated synthetic HTML at exactly 5,356, 65,536 and 524,288 UTF-8 bytes. Each upload size was tested once as a new plan and twice as a new version. D1 was seeded with synthetic metadata so the main dashboard/list tests saw 58 plans and 100 versions, matching the observed user dashboard size. The later detail test saw three versions of its plan. No user plans were copied into Cloudflare.

Requests were sequential from Sydney. The sample includes first and subsequent route requests, but does not control isolate placement, cold starts, or concurrency. CPU logs report integer milliseconds; small samples and rounded measurements do not justify production percentiles. HTTP wall time was recorded separately and was not used as CPU time. Shoo identity-provider exchange, browser asset loading, scheduled cleanup CPU and a simultaneous-request workload were not tested.

## Cleanup and allowance checks

Preflight and postflight account checks found no paid Workers subscription or usage threshold breach. Public access was enabled only for the bounded experiment and then disabled. All six existing stop controls passed, including the persistent D1 latch, workers.dev/previews, Cron removal and private R2 access.

Nine R2 objects were written, totaling 1,785,540 reserved bytes; application reads consumed 28 reservations. All nine objects were deleted and independently verified absent. Synthetic version/event rows were removed, 58 draft tombstones retained, and the temporary bootstrap API key revoked. The application and probe lifetime counters were preserved: nine application writes, 28 reads, and the previous two probe reservations. The database remains initialized with no active drafts or version rows. Recovery will require a new test credential; initialization intentionally does not revive a revoked bootstrap key.

The postflight analytics snapshot reported 115 Worker requests, 8,942 D1 rows read, 1,127 written and 35 Durable Object requests over its rolling window. These account metrics lag and include earlier activity; they are not an exact test counter or invoice. The operation bounds and verified object deletion provide the immediate spending evidence. No plan upgrade, WAF subscription or unrelated resource change was made. The tested application version remains deployed with ingress disabled and the stop latched.

## Next engineering step

### Explicit Wrangler CPU limit

An additional configuration-only check attempted an undeployed version upload with `limits: { cpu_ms: 10 }`. Cloudflare rejected it with API error **100328: "CPU limits are not supported for the Free plan."** No version was deployed and no plan change was made. Free applies its platform CPU policy; setting a custom limit cannot make the current routes fit. Where custom limits are supported, repeated excess CPU terminates execution with Error 1102, with the documented allowance for occasional bursts. This is not an account-wide billing cap. [Wrangler limits](https://developers.cloudflare.com/workers/wrangler/configuration/#limits).

Keep the deployment stopped while profiling the upload path and SSR. The measured public-serving path is substantially lighter, but still had one 15 ms observation. Investigate client-rendering the dashboard, reducing upload parsing/serialization and repeated middleware work, and then rerun this bounded measurement. The current test identifies expensive routes; it does not yet identify their individual CPU hotspots or prove which optimization will bring them below 10 ms.
