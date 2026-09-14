# Cloudflare usage guard

The [GitHub workflow](../../../.github/workflows/cloudflare-usage.yml) checks account-wide Workers, D1, SQLite Durable Objects and R2 usage hourly at minute 17. It stops only the experiment resources named in [usage-policy.json](usage-policy.json). It does not deploy code, upgrade a plan, delete stored objects, or automatically restore service.

## Activation and manual operation

The repository has an Actions secret `CLOUDFLARE_USAGE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`, configured from the existing personal-account credential file. Neither credential value is committed. The workflow exposes the token only to its guard step on `master`; pull requests run unit tests without it. Prefer a dedicated account-scoped token when rotating credentials: Analytics Read, Workers Scripts Write, D1 Write, R2 Write and Account Settings Read for subscriptions. If adding zone routes, also grant Workers Routes Write only on the listed zones. All six current kill controls were verified with the configured token.

Merge the workflow into `master` to activate the schedule and manual dispatch. GitHub does not schedule workflows from this experiment branch. After merge, run:

```sh
gh workflow run cloudflare-usage.yml --ref master -f mode=audit
gh workflow run cloudflare-usage.yml --ref master -f mode=monitor
gh workflow run cloudflare-usage.yml --ref master -f mode=kill
```

- `audit` reads usage and configuration without changing them. It fails the job if a threshold, validation error or existing stop latch is detected.
- `monitor` checks usage and stops the experiment on any threshold breach or failed check, including partial/malformed analytics responses. A previous stop remains latched, even when usage falls.
- `kill` skips analytics and stops immediately. A verified manual stop succeeds; incomplete control actions fail the job.

Each run writes a JSON report to its logs and Actions summary. Threshold-triggered stops intentionally fail the job so Actions failure notifications can surface them. Configure those notifications in GitHub; no email, Discord or other external messaging service is added.

Local checks use the same script with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_USAGE_API_TOKEN` in the process environment:

```sh
python packages/cloudflare/usage/usage_guard.py --mode audit
python -m unittest discover -s packages/cloudflare/usage -p 'test_*.py' -v
```

The scheduled job uses Python's standard library, with no package installation or application build. Hourly execution is about 720–744 runs per month. GitHub bills runner time separately, rounding jobs up to minutes; this uses the account's shared Actions allowance in this private repository. Check that allowance before increasing frequency. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Thresholds and measurement

Daily metrics use a rolling 24-hour window, so midnight cannot prematurely reset protection. R2 operations use a rolling 31-day window to cover a monthly billing period without assuming its start date. This is deliberately more conservative than billing-period-to-date accounting. Account-wide totals include other applications, but the guard never stops those other applications.

| Metric                                               |      Stop threshold |
| ---------------------------------------------------- | ------------------: |
| Workers requests / 24 hours                          |              50,000 |
| Workers CPU / 24 hours                               |          400,000 ms |
| D1 rows read / written / 24 hours                    |  2,500,000 / 50,000 |
| D1 storage                                           |              2.5 GB |
| Durable Object requests / 24 hours                   |              50,000 |
| Durable Object duration / 24 hours                   |    6,500 GB-seconds |
| Durable Object SQLite rows read / written / 24 hours |  2,500,000 / 50,000 |
| Durable Object SQLite storage                        |              2.5 GB |
| R2 Class A / Class B operations / 31 days            | 500,000 / 5,000,000 |
| R2 storage peak / 31 days                            |                5 GB |

These are stop thresholds, not estimates of charges. Workers CPU is a workload threshold: Free has a per-invocation CPU limit, not a 400,000 ms daily allowance. Byte thresholds use decimal GB. The storage calculation sums maxima per resource, including R2 payload and metadata, rather than adding repeated time-series samples. This overestimates simultaneous storage and may continue tripping after objects are deleted. Analytics can lag behind current storage.

R2 operations are classified using the published pricing list. Unknown operations, non-Standard R2 storage, changed Workers subscriptions, invalid numbers, missing datasets, unexpected groups and potentially truncated results fail the check. Empty activity arrays represent no reported activity; they are not proof of fresh zero usage. All metrics are monitoring data, not an invoice or provider-enforced spending cap. [R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Kill behavior and recovery

The script attempts each control independently and verifies the result:

1. Persist `usage_guard.killed = 1` in the experiment's D1 database. The Worker checks this inside its atomic probe reservation, preserving the existing 20-probe lifetime cap.
2. Disable workers.dev and preview URLs.
3. Remove the Worker's Cron triggers.
4. Remove custom domains belonging to that Worker.
5. Disable the experiment bucket's r2.dev domain and enabled custom domains.
6. Remove routes targeting that Worker from explicitly allowlisted zones.

The current experiment has no zone routes, custom domains or Cron triggers. Add every relevant zone ID to the policy before introducing routes. The script does not enumerate unrelated zones or modify other Workers/buckets. A failed control does not prevent the remaining controls from running, and is reported as `stop_incomplete` rather than a successful shutdown.

Recovery is manual: investigate the report, fix the cause, confirm usage headroom, clear only the D1 kill flag, and restore intended ingress/triggers from deployment configuration. Do not reset the experiment's consumed-probe counter or delete the database. A redeploy alone cannot clear the stop flag in this Worker version; rolling back to code without the guard can bypass it. Keep disabled ingress in remote Wrangler configuration until intentionally restoring service. The guard does not keep a backup of removed route/domain/cron configuration.

## Limits of protection

GitHub can delay or drop scheduled runs. An unavailable runner, missing/expired token, malformed local policy, Cloudflare control-plane outage or cancellation can prevent shutdown; inspect failed/missing runs. The monitor cannot stop already-running requests, internal recursive calls, Durable Object alarms, direct authenticated R2 clients or unrelated resources. Stored data can continue accruing storage charges after traffic stops. Removing a Worker route can expose its underlying origin, so the zone allowlist must only contain routes whose origins are independently safe. [GitHub schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The experiment's private bucket and hard 20-probe × 512 KiB lifetime budget remain its immediate R2 safeguard. This workflow is additional protection; it cannot guarantee zero account-wide overages. The [PizzaConsole article](https://pizzaconsole.com/blog/posts/programming/cf-overage) motivated the monitor/disconnect/manual-recovery approach, adapted here to GitHub Actions and the Free-plan experiment.

## Validation: 14 September 2026

Fourteen Python tests cover metric validation, units, thresholds, rolling windows, account scope, dry-run safety, failed analytics, partial shutdown, persistence and preserving other Workers. Ten workerd tests pass, including the new persistent stop reservation check.

A live audit returned healthy usage. The manual kill verified all six currently applicable controls. A subsequent authenticated probe returned 429 from the deployed stop latch; after killing ingress again, the public endpoint returned Cloudflare 404. The Worker remains disabled and latched. The first immediate homepage check after re-enabling had not propagated yet, so it is not claimed as an HTTP 200-to-404 test. No additional R2 object was written by this validation.
