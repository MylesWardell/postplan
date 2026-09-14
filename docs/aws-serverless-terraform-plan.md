# Terraform serverless deployment plan

Proposed deployment for three developers publishing at most one plan each per hour. This planning PR does not implement the database migration, add runnable Terraform resources, or deploy AWS infrastructure. The [EC2 alternative](aws-deployment-plan.md) remains available for the existing SQLite application.

## Architecture and cost

Use a Regional API Gateway **HTTP API** with a custom HTTPS domain, one Bun application Lambda, DynamoDB on-demand, and private S3. A separate small Lambda runs daily retention cleanup. Default region: `ap-southeast-2`, configurable. Serve built application assets from the application Lambda initially.

Keep Bun, TanStack Start, oRPC, Shoo sign-in, signed session cookies and the CLI contract. Replace SQLite persistence. No VPC, NAT gateway, server, RDS, Redis, load balancer or provisioned concurrency is needed.

This adjusts the earlier CloudFront + Function URL suggestion. CloudFront OAC with an IAM-protected Function URL requires clients to hash POST/PUT bodies, complicating native forms and bearer authentication. HTTP API works with existing forms through the Web Adapter and provides custom domains directly. Defer CloudFront until traffic warrants it. [OAC requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html), [Web Adapter](https://github.com/aws/aws-lambda-web-adapter).

Expected working-hours usage is about 500 uploads/month; the round-the-clock maximum is about 2,200. Count page views, asset requests and other API calls separately. For illustration, 10,000 HTTP API calls at a $1/million regional rate cost $0.01; verify Sydney prices before applying. Allow **US$1–5/month** initially, excluding domain registration, tax and paid CI. This is an estimate, not a benchmark: account-wide free allowances, retained HTML, image storage, logs, DNS, backups and egress affect the bill. [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), [S3 pricing](https://aws.amazon.com/s3/pricing/).

## Configurable retention

Expose `PLAN_RETENTION_DAYS` to the application and cleanup worker. Terraform's `plan_retention_days` supplies the same string value to both functions.

| Value                                      | Behaviour                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Unset                                      | `90` days: the operational definition of three months               |
| Positive whole number                      | Expire this many 24-hour days after the last successful HTML upload |
| `0`                                        | Disable automatic plan expiry                                       |
| Negative, fractional, blank or non-numeric | Reject at startup and through Terraform validation                  |

Reject values that exceed safe timestamp arithmetic. Otherwise permit any whole-day duration, with examples `30`, `90`, `365` and `0` in the implementation's README and `.env.example`. This is deployment-wide policy, not user-supplied upload metadata.

Store `lastUploadedAt` separately from `updatedAt`, and calculate `expiresAt = lastUploadedAt + PLAN_RETENTION_DAYS * 86400` using UTC epoch seconds. A successful new version refreshes the **whole plan and all previous versions**. Views, downloads, title/description edits and enabling/disabling do not extend its life. Accounts, identities and API keys are not subject to plan retention.

Changes apply to existing plans without rewriting every item. Shortening retention can immediately hide old plans and make them cleanup candidates. Lengthening it or setting `0` can expose a still-active plan again only before cleanup claims it. A plan in `DELETING` cannot be revived. Uploads to expired plans fail; create a new plan instead. Explicit user deletion still works when automatic expiry is disabled.

**Use read-time expiry checks plus daily cleanup, not native DynamoDB TTL on active plans.** Every draft, version, raw URL, dashboard list/detail and mutation must check the current deadline and lifecycle state. Use 404 for unavailable plans and `Cache-Control: no-store` for draft HTML, including specific versions. Previously downloaded HTML cannot be recalled.

DynamoDB TTL deletes asynchronously and cannot cascade to S3. Removing active parent/version records first can lose the information needed for cleanup. Enable native TTL on `ttlAt` for completed cleanup tombstones and rate-limit counters only. Keep active plans and their version records free of TTL. [Verified retention details](aws-retention-research.md).

### Cleanup protocol

1. Page through the small plans table and evaluate the current policy. When retention is `0`, skip new age-based claims but resume existing `DELETING` records and explicit deletions.
2. Conditionally claim a stale plan `ACTIVE -> DELETING`, matching its observed revision and `lastUploadedAt`. Upload commits require `ACTIVE`, ownership, matching revision and an unexpired plan. One competing operation wins; the other fails or retries. A disabled plan still has an `ACTIVE` lifecycle until claimed.
3. Record `deletionStartedAt`. Wait at least 24 hours before final purge, longer than the maximum upload invocation lifetime, so an in-flight S3 write cannot arrive after final cleanup. The plan stays inaccessible during this grace period.
4. Delete every object under `drafts/<id>/`. For imported versioned buckets, enumerate and delete all object version IDs and delete markers too. Paginate, inspect individual errors and retry failures.
5. Delete version/event/intent records, retrying unprocessed batch writes. Keep the parent until S3 and child cleanup both succeed. Replace it with a minimal tombstone and `ttlAt = now + 7 days`.
6. Reconcile abandoned uploads and orphan prefixes older than 24 hours. Preserve active upload intents and committed version references; recheck state before deleting. Immediately clean up failed S3/database commits when possible; scheduled reconciliation is the fallback.

New-plan uploads reserve their ID and an upload intent conditionally before S3 writes. Existing-plan intent creation must transactionally check ownership, `ACTIVE` and current expiry before writing S3. Recheck those conditions when publishing the version and refreshing the parent in a transaction. Never reuse a tombstoned ID. Failed intents remain discoverable until reconciled.

Physical removal targets roughly 48 hours after logical expiry when daily jobs succeed; this is not a strict erasure guarantee. Keep failed work indefinitely until completed, and alert on errors/overdue cleanup. If a run approaches its time budget, save a continuation cursor and resume. At this scale a paginated scan is simpler than Streams; filters do not eliminate read costs.

Do not put a blanket 90-day S3 lifecycle rule on HTML: a recent upload may have extended the lifetime of its older versions. For a **new** HTML bucket leave S3 versioning off, since application versions already have immutable UUID keys. This sacrifices recovery from accidental object deletion for simpler retention. Existing versioned buckets need version-aware deletion; suspending versioning does not remove old copies. Abort incomplete multipart uploads after one day.

Use seven-day DynamoDB PITR for durable metadata. Expired metadata can remain recoverable in that window; restoring a table must reapply current retention before serving it. The minimal design has no separate HTML backup. Avoid indefinite exports/backups; migration exports require a stated expiry. This is stale-plan housekeeping, not guaranteed removal from every backup at day 90. [Backup exceptions](aws-retention-research.md#backup-exceptions).

## Database and application changes

Queries are mostly in `apps/server/src/routers/account-store.ts` and `draft-store.ts`; schema-derived types, context, initialization, health checks and tests also depend on SQLite. Introduce a persistence interface and a DynamoDB SDK implementation. This is a backend migration, not a Drizzle driver swap.

| Proposed table  | Keys and access patterns                                                                                           | Retention                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Identity/access | `pk` + `sk`; accounts, unique provider/subject mapping, token-hash key lookup, account index for key lists         | No plan TTL                            |
| Plans           | `draftId`; owner, lifecycle, revision, current-version summary/count, `lastUploadedAt`; account/updated-time index | App policy; `ttlAt` only after cleanup |
| Plan records    | `draftId` + typed sort key for padded version numbers, events and upload intents                                   | Explicit cleanup                       |
| Rate limits     | Hashed subject/window key, count, window end                                                                       | Native TTL housekeeping                |

Preserve identity uniqueness, key revocation, ownership and increasing version numbers with conditional transactions. Denormalize version summaries/counts to replace SQL joins. Use strongly consistent base-table reads for security and expiry decisions; indexes supply candidate lists only. Paginate every scan/query and return complete existing API results or introduce explicit API pagination without silent truncation. [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).

Store metadata only, never HTML. Validate serialized metadata/item size before uploading. Reduce `lastUsedAt` writes to periodic updates. Shared rate-limit windows must check timestamps explicitly, independent of delayed TTL deletion. Move bootstrap seeding from every cold start to an idempotent deployment command. Preserve session secrets, key hashes and Shoo identities.

Retain `POSTPLAN_ALLOWED_LOGIN_DOMAINS` from current master. Propose authenticated uploads only for this three-developer deployment; otherwise current anonymous uploads expose usage to anyone. Configure permitted login domains explicitly. A domain allowlist is not an exact three-person allowlist, so key distribution and domain membership still matter. Public plan links remain public.

## Terraform layout and resources

Create the following during implementation; this PR adds no executable `.tf` files:

```text
infra/terraform/bootstrap/   # Remote state, ECR and GitHub OIDC deployment role
infra/terraform/app/         # API, functions, data, cleanup, DNS and monitoring
infra/terraform/app/production.tfvars.example
```

Use Terraform >= 1.10, a reviewed AWS provider version constraint and a committed provider lockfile. Bootstrap and app have separate state keys. Reuse an approved remote state bucket, or create a private encrypted versioned S3 bucket and migrate bootstrap state into it. Set `use_lockfile = true`; no DynamoDB lock table. Plan-retention rules never apply to Terraform state. [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).

| Group      | Terraform resources/settings                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images     | `aws_ecr_repository`, immutable tags; conservative lifecycle preserving current and rollback digests; build/push in CI                                                                   |
| App        | `aws_lambda_function` image package, published versions, `aws_lambda_alias`; initially 512 MB, 25-second timeout, x86_64 until ARM compatibility is tested; no provisioned concurrency   |
| API        | `aws_apigatewayv2_api` HTTP, `$default` route/stage, AWS_PROXY integration payload v2, 29-second integration timeout, alias-scoped `aws_lambda_permission`; disable execute-api endpoint |
| HTTPS/DNS  | Regional `aws_acm_certificate` and validation, root/optional wildcard `aws_apigatewayv2_domain_name` and mappings; reuse existing DNS zone                                               |
| Data       | Four `aws_dynamodb_table` resources with PAY_PER_REQUEST, explicit indexes, TTL above, seven-day PITR for durable tables, deletion protection and `prevent_destroy`                      |
| HTML       | Private `aws_s3_bucket`, public-access block, encryption, TLS-only policy, multipart-abort lifecycle, `force_destroy = false`, `prevent_destroy = true`                                  |
| Cleanup    | Separate Lambda handler/artifact and role, daily `aws_scheduler_schedule`, invoke role, scheduler retries and SQS DLQ; worker concurrency 1, 300-second timeout                          |
| Monitoring | Explicit log groups with 14-day retention; API/Lambda errors, throttles, cleanup failure/age alarms; US$5 budget notification and configurable recipient                                 |

Start API throttles at 10 requests/second with burst 20 and app reserved concurrency at 5, subject to account quota. Throttles and budget alerts are not hard spend caps. Monitor scheduler delivery failures separately from Lambda execution failures; configure an async failure destination for worker invocation failures and retain database work records for replay.

Separate app, cleanup, scheduler and deployment roles. Scope app permissions to named table/index operations, S3 Get/Put on `drafts/*`, narrowly required failed-upload cleanup, exact secret reads and logs. Cleanup gets required table scan/query/update/delete and bucket list/delete confined to the plan namespace. Scope `iam:PassRole` to named roles; no general admin policy for CI.

Inputs: region, domain, existing hosted-zone ID or external DNS mode, wildcard enablement, immutable image digest, `plan_retention_days = 90`, allowed login domains, session-secret parameter ARN, optional bootstrap-secret ARN, memory/concurrency, schedule, log retention and notification recipient. Output application/health URLs, ECR URL, bucket/table names and external-DNS validation records where needed.

Terraform stores secret ARNs only. Supply SecureString values separately through the existing secret system and read them before initializing application config/session handling. Never read decrypted values into Terraform data sources, or store secrets in `.tfvars`, CI logs, outputs or images.

## Lambda and HTTP compatibility gate

Add a pinned Lambda Web Adapter to a dedicated Docker target. Keep the Bun host, port 3000 and built assets; remove persistent filesystem writes and use `/tmp` only for temporary files. Initialize configuration/persistence before `/healthz` reports ready. Cleanup has its own executable and no HTTP listener.

Use buffered HTTP API responses. Test TanStack SSR/server functions, native form POSTs, multiple `Set-Cookie` headers, redirects, bearer authorization, compression and binary/base64 handling through the actual adapter. Verify 512 KiB HTML uploads plus JSON/event overhead against the smallest transport limit. Bound or paginate list/history responses to fit buffered Lambda limits. Streaming is outside this initial design.

When using subdomains, issue a regional ACM certificate for both `plans.example.com` and `*.plans.example.com` and map both to the same API stage without a path prefix. Preserve public hostname/scheme for draft isolation, origin checks and OAuth redirects. Derive client IP from trusted API Gateway context through the adapter, not arbitrary forwarded headers. Test spoofed host/IP headers and disable the generated execute-api endpoint. [HTTP API domains](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-custom-domain-names.html), [endpoint control](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-disable-default-endpoint.html).

## Delivery and rollout

1. Implement persistence/retention and local DynamoDB integration tests. Update README, `.env.example`, database guidance, bootstrap tooling and health checks. Keep the current SQLite release usable until acceptance passes.
2. Build/test the adapter image in CI. Preserve current Bun checks, CLI packing and Docker checks. Add Terraform format/validate checks and GitHub OIDC deployment permissions scoped to this repository and deployment environment.
3. Resolve AWS account/profile, region, domain/zone, secret locations, permitted login domains, notification recipient and whether existing plans need import. This document assumes no live resource identities.
4. Provision bootstrap resources, push the reviewed image and generate a saved app Terraform plan. Review its concrete diff and resource identities before apply. No build provisioners or automatic production apply from PRs.
5. If importing data, stop old writes, take a consistent SQLite export and preserve IDs, hashes and object keys. Derive `lastUploadedAt` from the newest successful version, not title edits. Report stale candidates before cleanup. Copy/verify HTML when changing buckets; preserve the source through cutover and agree an explicit expiry for migration exports.
6. Deploy with cleanup paused, seed idempotently and run acceptance on the actual API domain. Then enable the schedule and verify both success and failure handling with disposable records.
7. Configure the three developers' CLI endpoint. Retain the previous image digest/export for rollback and require a full Terraform plan with no unexpected drift.

For a policy change: pause the schedule, drain cleaners, update both functions, fully move the app alias to the new version, drain old app invocations, then resume cleanup. Preview stale candidate counts for shorter policies. Do not independently edit the Lambda environments in the console; Terraform does not update both atomically.

## Acceptance and recovery

- Sign-in, login-domain restrictions, key mint/revoke, native forms, CLI uploads and exact HTML retrieval work through the real domain. Proposed private-upload mode rejects anonymous uploads.
- Concurrent versions preserve ordering/latest pointers; concurrent sign-ins preserve unique identities. Revoked keys cannot authorize via stale indexes.
- Root, draft subdomain and raw URLs preserve host isolation, cookies, redirects, origin checks and trustworthy client IP.
- Fake-clock tests cover expiry boundaries, upload-only refresh, 30/90/365 days, `0`, invalid values, changes on existing plans, disabled plans and old version links. Run a live short-retention fixture without changing production policy.
- Race uploads against cleanup. Inject partial S3/DynamoDB failures and worker timeouts. Verify pagination, duplicate invocations, upload-intent grace, immediate read denial and complete child/object deletion; failed cleanup retains its record.
- Test alarms and scheduler/worker failure destinations. Restore a disposable PITR table and reapply retention before serving it. Measure cold starts and memory before final sizing.

Rollback to a compatible prior DynamoDB-backed image via the Lambda alias. Once DynamoDB accepts writes, the old SQLite release is not a safe rollback target without reverse migration or an explicit data-loss decision. Pause cleanup during recovery. Restoring metadata or increasing retention cannot recover deleted HTML. Every rollback image must preserve expiry checks.
