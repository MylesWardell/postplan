# Cloudflare usage guard

The [workflow](../../../.github/workflows/cloudflare-usage.yml) checks account-wide Workers, D1, Durable Objects and R2 usage hourly. It can stop the Worker and bucket named in [usage-policy.json](usage-policy.json).

## Configure

Update the policy's resource identifiers, zone IDs and thresholds for your deployment. Add the GitHub Actions variable `CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_USAGE_API_TOKEN`. The token needs Analytics Read, Workers Scripts Write, D1 Write, R2 Write and Account Settings Read; configured zone routes also need Workers Routes Write. PRs only run credential-free tests.

```sh
gh workflow run cloudflare-usage.yml --ref master -f mode=audit
gh workflow run cloudflare-usage.yml --ref master -f mode=monitor
gh workflow run cloudflare-usage.yml --ref master -f mode=kill
```

- `audit`: read usage and configuration without changes.
- `monitor`: stop on a threshold breach or failed check.
- `kill`: stop immediately without checking analytics.

Daily metrics use a rolling 24-hour window; R2 operations use 31 days. Reports appear in Actions logs and summaries. Scheduling and analytics can lag, so this is not a billing cap.

## Recovery

A stop latches D1, disables Worker public URLs, removes its Cron triggers and custom domains, disables public bucket access, and removes Worker routes in the listed zones. It does not delete stored objects or restore service automatically.

Investigate the report and fix the cause before clearing the D1 kill flag and restoring intended ingress and triggers. Preserve consumed storage counters. A redeploy alone does not clear the latch.

Run the guard tests with:

```sh
python -m unittest discover -s packages/cloudflare/test -p 'test_*.py' -v
```
