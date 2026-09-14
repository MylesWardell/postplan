# AWS plan retention research

Verified against primary AWS documentation on 2026-09-14. Design recommendation for three developers; no resources provisioned.

## Recommended policy

Interpret three months as **90 days since the last successful HTML upload** by default. Configure `PLAN_RETENTION_DAYS` as an integer: default `90`, `0` disables age-based expiration, negative or fractional values fail validation. One Terraform variable supplies the same value to the web and cleanup Lambdas. Reading, renaming, enabling, and disabling a plan do not refresh its age. A successful new version refreshes the whole plan, preserving its earlier versions until the plan expires. This is application policy, not an AWS limitation.

Store `lastUploadedAt` on the parent and calculate the effective deadline from that timestamp plus the current policy. Policy changes therefore apply to existing active plans without rewriting all records; do not rely on a persisted deadline from an older configuration. Every public and authenticated read must reject an expired parent immediately, including reads of specific versions. Exclude expired parents from lists. If CloudFront is added later, disable its caching for plan HTML and metadata. Always use `Cache-Control: no-store` so a cached response cannot bypass this check. Previously downloaded files cannot be recalled.

**Use a daily scheduled cleanup Lambda as the primary deletion mechanism, with DynamoDB TTL only for completed cleanup tombstones and short-lived rate-limit items.** At this scale, a paginated scan of parent records is a reasonable starting design; filtering reduces returned data, not the underlying scan work. An expiry index can replace that scan if volume grows.

Proposed deletion protocol:

1. Scan for expired parents and unfinished `DELETING` parents. Recheck/claim each expired parent with a conditional update requiring its expected revision, `ACTIVE` state, unchanged `lastUploadedAt`, and `lastUploadedAt <= now - retentionDays * 86400`. With retention disabled, skip new claims but finish already claimed work.
2. Upload publication must conditionally require `ACTIVE` and an unexpired parent under the current policy, and atomically refresh `lastUploadedAt` with version metadata. This makes expiry cleanup and a successful refresh mutually exclusive. Expired plans cannot receive uploads while expiration applies. Increasing retention or setting it to zero can expose a still-`ACTIVE` plan again, but never one already claimed for deletion.
3. Keep the claimed parent as a durable work record with no TTL. The deployment plan adds a 24-hour grace period after claiming, exceeding the maximum upload invocation lifetime, before final purging. Delete all S3 objects under its immutable plan ID prefix and all child version metadata, paging through every result and retrying individual failed deletes. Missing objects/items count as success. Repeated invocations must be safe.
4. Once deletion is verified, mark the parent `DELETED` and set a separate `ttlAt` attribute to seven days later for tombstone removal. Do not put `ttlAt` on active parents or child versions; otherwise an old child deadline can remove history while the parent has been refreshed.
5. Persist unfinished work for the next daily invocation; report cleanup errors and oldest pending age. Reconcile orphaned uploads separately using an upload-intent record/age grace period so cleanup cannot delete an in-flight upload. Never treat merely missing metadata immediately after S3 upload as proof of an orphan.

This preserves a recoverable cleanup record during prolonged worker failure. Logical access ends at the deadline; with the deployment plan's 24-hour grace, physical cleanup targets roughly 48 hours later and can lag during failures. It does not promise physical erasure at exactly 90 days.

The `DELETING` claim is irreversible: disabling or lengthening retention does not cancel deletion or recreate removed data. Coordinate policy rollouts by pausing scheduled cleanup, draining running cleanup invocations, updating both Lambda configurations, then resuming scheduling. Otherwise an old worker can make a deletion claim using the previous, shorter retention period while the app uses the new value.

## Why TTL alone is insufficient

DynamoDB TTL requires a Number containing Unix epoch seconds. Expired records are normally removed within a few days; they can still be returned and updated before physical removal. TTL is therefore a storage cleanup facility, not an exact access deadline. Its deletion applies to the expired item, so deleting a parent does not implement this application's child/S3 cleanup protocol. Single-region TTL deletes do not consume write throughput. [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)

An alternative is parent TTL plus a Streams Lambda that deletes S3 and children. TTL stream removals can be identified by `userIdentity.type = Service` and `principalId = dynamodb.amazonaws.com`; use an old-image stream view to retain the deleted parent's cleanup identifiers. [TTL and Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-streams.html)

However, stream records last only 24 hours, and Lambda processing can be duplicated. Cleanup must be idempotent. [Streams lifetime](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), [Lambda delivery](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)

After record age or retry limits are reached, Lambda can discard failed batches. SQS/SNS failure destinations contain invocation metadata; an S3 destination also retains the full invocation payload. A robust Streams implementation therefore needs bounded retries, partial-batch handling, a durable failure destination, replay, alarms, and reconciliation. Given this project's small volume, retained cleanup records plus one scheduled worker are easier to operate. [Failed DynamoDB stream invocations](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html)

## S3 retention

Do **not** apply an age-90-days expiration rule to plan HTML: S3's age is the individual object's age, while this policy refreshes the entire plan. Such a rule could erase version 1 of a plan that received version 2 yesterday. Deletion must follow the parent deadline instead. S3 expiration is also asynchronous. [S3 expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)

For a new bucket, leave S3 Versioning disabled when the app already writes immutable, unique keys per plan version. This is an application design choice: it reduces hidden retained copies, but gives up S3's protection against accidental deletion. Keep Terraform state in a separate versioned bucket; this recommendation is for uploaded plan HTML only.

If S3 Versioning is enabled, a normal delete only creates a delete marker and retains bytes. Cleanup must enumerate and delete specific object version IDs and delete markers to erase the prefix. A noncurrent-version lifecycle rule can provide eventual cleanup, but introduces a separate retention window. Do not confuse the application's numbered versions (separate keys) with S3 versions (multiple bodies at one key). [Deleting versioned objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html), [Lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)

## Backup exceptions

Enable a short, explicit DynamoDB PITR window (proposed: seven days) if recovery from accidental metadata writes/deletes is useful. PITR permits 1–35 days and restores a historical state to a new table, so logically expired/deleted metadata can remain recoverable during that window. This is an explicit backup exception to live retention, not a mechanism for restoring already deleted HTML. [Backup and restore](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Backup-and-Restore.html)

Avoid indefinite on-demand backups or exports by default. On-demand backups persist until explicitly deleted; exports and copied data require their own retention rules. Deleting a PITR-enabled table also creates a system backup retained for 35 days. [On-demand backup retention](https://aws.amazon.com/dynamodb/features/), [System backup expiry](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BackupSummary.html)

A restore runbook must reapply TTL, Streams if used, PITR, and IAM/alarms; these settings are not all restored automatically. Before serving a restored table, retain the read-time expiry check and reconcile expired plans and absent S3 objects so restoration does not republish stale metadata. [Restore requirements](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreTableToPointInTime.html)

## Terraform implications

- DynamoDB `PAY_PER_REQUEST`, TTL enabled on `ttlAt`, explicit PITR recovery period.
- Validated Terraform retention-days variable shared by both functions as `PLAN_RETENTION_DAYS`; no independently configured expiry window.
- EventBridge Scheduler daily invocation, cleanup Lambda and narrowly scoped execution role, invocation permission, retry configuration and failure monitoring.
- App role reads/writes metadata and uploads/reads objects; cleanup role owns deletion of the dedicated plan prefix and related metadata.
- Private HTML bucket, no age-based expiration of committed plan files; optional incomplete multipart-upload cleanup.
- If using Streams instead, add old images, filtered event mapping, retry/partial-batch settings, full-payload failure storage, and replay/reconciliation. These are optional alternative resources, not required by the recommended scheduled-worker approach.

Acceptance checks should exercise expiry at the exact boundary, refresh immediately before expiry, competing cleanup/upload writes, old versions retained after refresh, partial S3 deletion failure, worker restart, pagination, duplicate invocation, orphan grace, and restored stale metadata.
