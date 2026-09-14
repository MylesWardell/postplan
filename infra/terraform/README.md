# Terraform infrastructure

Two independent roots provision the [serverless design](../../docs/aws-serverless-terraform-plan.md):

- `bootstrap/`: versioned state bucket, immutable ECR repositories and a GitHub OIDC image-publishing role.
- `app/`: HTTP API and regional HTTPS domains, app/cleanup Lambdas and aliases, four DynamoDB tables, private HTML storage, disabled-by-default cleanup schedule, failure queue, logs, alarms and an account-wide budget.

Build the `lambda-app` and `lambda-cleanup` Docker targets and supply their ECR image digests. The server selects DynamoDB when all four table names are set; the default `runtime` image also supports SQLite. DynamoDB persistence, retention cleanup, private-upload enforcement and SSM secret loading are implemented. AWS deployment acceptance is still required before enabling cleanup or opening traffic.

## Validate without AWS

Use Terraform >= 1.10; CI uses 1.16.2. Both roots pin AWS 6.x through committed provider lockfiles.

```sh
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/bootstrap init -backend=false -lockfile=readonly
terraform -chdir=infra/terraform/bootstrap validate
terraform -chdir=infra/terraform/bootstrap test
terraform -chdir=infra/terraform/app init -backend=false -lockfile=readonly
terraform -chdir=infra/terraform/app validate
terraform -chdir=infra/terraform/app test
```

Tests mock AWS: they exercise Terraform plans without credentials or cloud resources. They do not prove service permissions, image compatibility, DNS ownership or production acceptance.

## Bootstrap

Use an authenticated operator profile with permissions for the reviewed resources. Set `AWS_PROFILE` locally; no credentials belong in Terraform files. Copy `bootstrap/production.tfvars.example` to the ignored `bootstrap/production.tfvars` and enter the account, region and exact GitHub repository/environment.

If the account already has the GitHub OIDC provider, supply its ARN. The publisher role trusts only the named repository and environment; protect that GitHub environment with branch restrictions and reviewers before use. Its policy can push/pull only the two ECR repositories and cannot apply Terraform or assume an infrastructure admin role. Infrastructure applies remain operator-driven; no AWS deployment workflow runs on PRs.

```sh
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan -var-file=production.tfvars -out=bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
```

Review the saved plan before applying. The first bootstrap uses local state. Copy `bootstrap/backend.tf.example` to `bootstrap/backend.tf`, and `backend.hcl.example` to `bootstrap/backend.hcl`. Set the output bucket name and `key = "postplan/bootstrap.tfstate"`, then migrate:

```sh
terraform -chdir=infra/terraform/bootstrap init -migrate-state -backend-config=backend.hcl
```

Verify remote state before retiring the local backup. Backend files, state, saved plans and personal tfvars are ignored. Protect backend access independently from the image publisher. Do not grant it state-bucket access. If using an existing approved state bucket, adopt it explicitly with imports and verify its settings before apply; do not create a duplicate bucket or overwrite unrelated state.

Tagged ECR release images are retained. Untagged images expire after 30 days. Keep current and rollback digests tagged and retire old release tags only after confirming no published function version needs them.

## Application

1. Build/test the two runtime images and push immutable release tags to the bootstrap ECR repositories. Record their SHA-256 digests; app and cleanup are distinct entry points.
2. Create the session secret as an SSM SecureString through the existing secret-management process. Set the parameter ARN, never its value, in Terraform. Optional bootstrap secrets use a separate ARN; optional customer-managed encryption keys require `secret_kms_key_arn`.
3. Copy `app/production.tfvars.example` to ignored `app/production.tfvars`. Enter real image digests, DNS ownership, login domains and an alarm recipient. Keep `cleanup_enabled = false`.
4. Copy `backend.hcl.example` to `app/backend.hcl`, using the bootstrap bucket and the distinct key `postplan/app.tfstate`.
5. Initialize, inspect a saved plan, and apply it only after the runtime passes its acceptance checks.

```sh
terraform -chdir=infra/terraform/app init -backend-config=backend.hcl
terraform -chdir=infra/terraform/app plan -var-file=production.tfvars -out=app.tfplan
terraform -chdir=infra/terraform/app apply app.tfplan
```

Route 53 mode reuses `hosted_zone_id` and owns only certificate validation and application alias records. Existing conflicting records require explicit adoption; no overwrite flag is enabled. The root and wildcard share one ACM validation record. If `hosted_zone_id = null`, Terraform emits records/targets for external DNS and does not manage Route 53. Issue the certificate first with a reviewed certificate-only bootstrap apply (`-target=aws_acm_certificate.app`), add its validation record externally, then do a full plan/apply. Add the emitted root/wildcard DNS targets externally. Never treat the targeted bootstrap as a completed deployment.

The generated execute-api endpoint is disabled; test through the configured HTTPS domain. Confirm the SNS email subscription to receive operational alarms. The US$5 budget is explicitly **account-wide**, so an account hosting other applications should increase it appropriately. Alerts and throttles are not hard spending limits. Reserved concurrency requires enough account quota to preserve AWS's unreserved pool.

## Runtime contract

Both functions receive `PLAN_RETENTION_DAYS`, `AWS_S3_BUCKET_NAME` and `POSTPLAN_IDENTITY_TABLE`, `POSTPLAN_PLANS_TABLE`, `POSTPLAN_RECORDS_TABLE`, `POSTPLAN_RATE_LIMITS_TABLE`. Lambda supplies `AWS_REGION`; do not set reserved AWS environment variables.

The launcher loads `POSTPLAN_SESSION_SECRET_PARAMETER_ARN` (and optional `POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN`) before initializing configuration/authentication. The app enforces `POSTPLAN_ALLOW_ANONYMOUS_UPLOADS=false`, `POSTPLAN_ALLOWED_LOGIN_DOMAINS`, domain/origin checks, and trusted API Gateway client-IP extraction when `POSTPLAN_API_GATEWAY=true`. Run `bun apps/server/dist/src/db/bootstrap.js` once with deployment credentials and the configured table names to seed an optional administrator key; cold starts do not seed DynamoDB.

App images must include the Lambda Web Adapter, listen on port 3000, and support buffered API Gateway v2 requests. Built assets remain inside the image. Cleanup images implement the Lambda runtime protocol directly; they do not run an HTTP server. Both are Linux x86_64, use temporary storage only, and must support their configured timeouts.

| Table    | Primary key             | Secondary index                                | Native TTL                           |
| -------- | ----------------------- | ---------------------------------------------- | ------------------------------------ |
| Identity | `pk` (S), `sk` (S)      | `by-account`: `accountId` (S), `createdAt` (N) | None                                 |
| Plans    | `draftId` (S)           | `by-account`: `accountId` (S), `updatedAt` (N) | `ttlAt` on completed tombstones only |
| Records  | `draftId` (S), `sk` (S) | None                                           | None                                 |
| Limits   | `pk` (S)                | None                                           | `ttlAt`                              |

The app enforces uniqueness/ownership via conditional transactions and uses consistent base-table reads for revocation/expiry. Indexes are eventual. It never assigns `ttlAt` to active plans. HTML uses immutable objects under `drafts/<id>/`; the bucket has no object-age expiration rule or S3 versioning. SQLite remains available for local deployments; existing SQLite data requires a separate migration before cutover. See [database configuration](../../apps/server/DATABASE.md).

## Retention operations

Set `plan_retention_days` in tfvars (or `TF_VAR_plan_retention_days`) to configure `PLAN_RETENTION_DAYS` identically on both functions: default 90, 0 disables automatic expiry. Values are whole nonnegative days with a safe-arithmetic ceiling. The application computes age from the last successful upload and applies changes to existing plans.

The cleanup contract is defined in the [retention plan](../../docs/aws-serverless-terraform-plan.md#cleanup-protocol). It claims stale plans conditionally, waits 24 hours, deletes S3 and child records with retries, then sets a seven-day tombstone TTL. The worker pages through results, preserves failed work, reconciles upload intents/orphans and emits `OldestPendingAgeSeconds` (zero when idle) without dimensions to `Postplan/<name>` after every successful run. The overdue alarm treats missing metrics as failure when cleanup is enabled.

Before enabling `cleanup_enabled`, verify the real worker against disposable records, partial failures and its failure destination. Scheduler delivery failures and asynchronous worker failures go to the failure queue; retain/replay messages and inspect durable database work records. The queue retains messages for 14 days, so it is not the only retry ledger.

For policy changes, first apply with cleanup disabled, wait for running workers to finish, update retention on both functions, drain old app invocations, then enable cleanup in a separate apply. Preview candidates before shortening retention. Setting 0 does not cancel already-claimed deletions or resurrect deleted data.

PITR retains durable metadata for seven days; it cannot recover deleted HTML. No age-based TTL is placed on identities or version rows. New HTML buckets are unversioned; importing a versioned bucket requires a worker that explicitly deletes object versions/delete markers. Terraform state retains its independent version history.

## Release and recovery

Update image digests through a saved Terraform plan; Terraform publishes versions and advances the `live` aliases. Keep compatible previous digests for rollback. A rollback to SQLite after DynamoDB has received writes requires a data migration. Pause cleanup during incident recovery and preserve expiry checks in rollback code.

Run the full acceptance list in the design before opening traffic: native forms/CLI, sessions, concurrent uploads, key revocation, domain isolation, payload limits, expiry races, cleanup retries, restore, alerts and measured cold starts. Finish each deployment with a full zero-diff plan. Local validation and mock tests do not replace that deployed acceptance.
