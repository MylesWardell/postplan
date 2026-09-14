# Cloudflare usage assessment

Update: the [bounded remote CPU test](./cloudflare-cpu-test.md) now confirms repeated overages of Workers Free's 10 ms allowance. All eight dashboard renders used 15–38 ms; all nine uploads used 14–132 ms. The volume estimates below still have ample headroom, but the current application is not reliably compatible with the Free CPU allowance. Temporary objects were deleted and the remote stop restored.

Assessed 14 September 2026. At the observed content volume and the owner's estimate of under 100 plan views/day, storage and operation counts should fit the free allowances comfortably. The unresolved constraint is CPU per Worker request, especially server-rendered dashboard and authentication routes. This is a capacity estimate, not a guarantee of a zero bill or deployed acceptance.

## Evidence and assumptions

Read-only inspection of the owner's Postplan dashboard found **58 drafts and 100 stored versions**. Visible latest-version dates span 12 August through 14 September; those dates do not establish the full upload history. The supplied public example returned **5,356 UTF-8 bytes** of standalone HTML, with inline CSS and no external asset references. Other plans were not downloaded or measured.

If all 100 versions resembled that sample, their HTML would total 535,600 bytes (0.536 MB). Even if every version used the connector's maximum 512 KiB, 100 versions would total 52.43 MB, about 0.52% of 10 GB. Metadata, logs and database indexes are separate from HTML storage.

For projections below, use 100 views/day, a 30-day month, one uncached HTML object read per view, and a planning allowance of 100 uploaded versions/month. The upload allowance is an assumption, not a measured rate. Browser assets, owner API/dashboard activity, retries, bots and monitoring add requests.

## Allowances and projected use

| Resource               | Free allowance                              | This workload                                                                                                      |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Worker requests        | 100,000/day                                 | 100 plan views/day; even 10 Worker requests per view is 1,000/day (1%)                                             |
| Worker CPU             | 10 ms per invocation                        | Needs representative remote measurement; low traffic does not relax it                                             |
| R2 Standard storage    | 10 GB-month                                 | Approximately 0.536 MB if all existing versions match the example; at most 52.43 MB for 100 maximum-sized versions |
| R2 Class A operations  | 1 million/month                             | About 100 puts/month under the upload assumption                                                                   |
| R2 Class B operations  | 10 million/month                            | About 3,000 gets/month (0.03%)                                                                                     |
| D1 rows read           | 5 million/day                               | Public lookup, auth and dashboard scans should be small at 100 versions; actual rows scanned require profiling     |
| D1 rows written        | 100,000/day                                 | Each HTML read also writes one budget row; uploads, indexes and cleanup add writes                                 |
| D1 storage             | 5 GB total                                  | Metadata for 100 versions is far below this; exact live application size is not measured                           |
| SQLite Durable Objects | 100,000 requests/day; 13,000 GB-seconds/day | Used for upload/key rate limits, not every public view                                                             |

Sources checked on the assessment date: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). R2 egress is free; Infrequent Access does not receive the Standard free tier. D1 Free stops accepting affected operations at its limits rather than automatically upgrading the account.

## Existing Cloudflare experiment

A read-only account audit at 12:11 UTC found:

- Last 24 hours: 10 Worker requests, 26 D1 rows read and 10 written; eight Durable Object requests and about 0.018 GB-seconds.
- D1 storage: 20,480 bytes. R2 peak storage over the queried 31 days: zero bytes.
- R2 operations over the queried 31 days: 28 Class A and 14 Class B.
- Persistent stop latched; Worker public exposure and R2 public access disabled. No paid Workers subscription was found.

Cloudflare emitted an additional zero-byte Infrequent Access analytics row for the same empty bucket. The guard now ignores that empty row, while still rejecting nonzero Infrequent Access usage and malformed/duplicate Standard groups. A regression test covers this observed response.

The ten historical Worker requests have reported CPU median **3.578 ms**, p99 **50.959 ms**, and mean **15.54 ms**. The analytics group identifies the script as `__unknown__`; this tiny mixed sample cannot identify expensive routes or establish this connector's performance. It does show why traffic totals alone cannot establish Free compatibility. Local wall time is not Worker CPU time. The connector now constructs its application router once per isolate, but the effect has not been measured remotely.

## Spending controls and conclusion

The application reserves at most 2,000 R2 writes, 1 GiB of cumulative HTML bytes and 250,000 reads over the database lifetime. It rejects HTML above 512 KiB and never refunds uncertain operations. Those bounds remain far below the R2 monthly operation allowances even if consumed in one burst. The separate probe has a further 20-operation/10-MiB lifetime allowance. Retention cleanup does not replenish budgets.

The GitHub hourly guard is a second layer, with a persistent stop and public-access shutdown. It cannot guarantee an exact account spending cap: GitHub jobs and Cloudflare analytics can be delayed, unrelated account resources share allowances, and objects already stored remain until deleted. Account credentials and direct bucket writes must remain restricted.

**Expected outcome:** the supplied usage should have ample storage and request headroom for $0 Cloudflare service usage. **Remaining release gate:** demonstrate reliable application requests within the Free CPU limit using a bounded representative remote experiment. No paid upgrade, new deployment, user-plan migration or remote stop reset was performed for this assessment. Domain and external identity-provider costs are outside this estimate.
