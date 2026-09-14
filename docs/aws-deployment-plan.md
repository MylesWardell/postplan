# AWS deployment plan

Status: planning only. No AWS resources have been created or changed. Deployment requires a later instruction. This repository supplies a container build and runbook; infrastructure as code and live acceptance remain future work.

## Proposed architecture

Use an internet-facing Application Load Balancer (ALB), ECS Fargate, private RDS PostgreSQL, and private S3. This fits the existing Express process and PostgreSQL transactions. Reuse the organisation's VPC, DNS and CI identity where appropriate. Account, region, domain and sizes are unconfirmed; `ap-southeast-2` is an example.

| Component   | Proposed configuration                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS and TLS | Route 53 alias to ALB; regional ACM certificate for service domain and wildcard if draft subdomains are used                                                  |
| Edge        | HTTPS; HTTP redirect; WAF upload rate rule; direct ALB ingress without CloudFront initially                                                                   |
| Compute     | ECR image by digest; Linux x86_64 Fargate; initially 0.5 vCPU / 1 GiB per task, two production tasks across two AZs; measure before final sizing              |
| Network     | Public ALB subnets; private tasks without public IPs; task port 3000 only from ALB security group; private RDS port 5432 only from task security group        |
| Database    | Supported RDS PostgreSQL version tested in staging; encryption, verified TLS, Multi-AZ production, PITR/backups, deletion protection and final snapshot       |
| Storage     | S3 Block Public Access, encryption, versioning, deny non-TLS access; HTML served through Express to preserve access checks and CSP                            |
| Secrets     | Secrets Manager injection for database URL, bootstrap API key and optional session secret                                                                     |
| Operations  | CloudWatch logs with retention; alarms for unhealthy targets, 5xx, latency, restarts, CPU/memory, RDS connections/storage; ALB access logs in separate bucket |

Private tasks need outbound access to Shoo for OAuth discovery, token exchange and JWKS. Provide controlled NAT egress or an approved equivalent. S3 gateway and ECR/CloudWatch/Secrets Manager interface endpoints can carry AWS traffic. Estimate regional costs for compute, database, ALB, NAT/endpoints, WAF, storage, backups and logs after agreeing traffic and availability requirements.

The ECS task role needs `s3:GetObject` and `s3:PutObject` only on `arn:aws:s3:::BUCKET/drafts/*`. No bucket listing or deletion is needed. For a customer-managed KMS key, add scoped decrypt/data-key permissions. Keep the execution role separate for ECR pulls, logging and named-secret retrieval. See [AWS task IAM roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).

## Runtime configuration

| Variable                                   | AWS value                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`, `PORT`                         | `production`, `3000`                                                                                               |
| `DATABASE_URL`                             | Secrets Manager; RDS hostname, URL-encoded credentials, dedicated user with current startup-schema DDL permissions |
| `DATABASE_SSL_CA_FILE`                     | `/app/certs/rds-global-bundle.pem`, included in Docker image                                                       |
| `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION` | Private bucket and selected region                                                                                 |
| `POSTPLAN_BOOTSTRAP_API_KEY`               | Random secret identical across tasks                                                                               |
| `POSTPLAN_PUBLIC_BASE_URL`                 | `https://*.plans.example.com` for subdomains or `https://plans.example.com` for path-based drafts                  |
| `POSTPLAN_SESSION_SECRET`                  | Optional strong random secret shared by tasks; required for dashboard sign-in                                      |
| `SHOO_BASE_URL`                            | Optional broker override; default `https://shoo.dev`                                                               |
| `TRUST_PROXY`, `CLIENT_IP_SOURCE`          | `1`, `req-ip` for client → ALB → task                                                                              |
| `REQUEST_ID_HEADER`                        | `x-amzn-trace-id`, for correlation rather than authentication                                                      |
| `SHUTDOWN_GRACE_MS`                        | `20000`; initially ECS `stopTimeout: 30` and ALB deregistration delay 20 seconds                                   |

Leave endpoint overrides, static AWS keys and path-style overrides unset for native S3. The SDK obtains temporary task-role credentials.

When a CA file is configured, omit `ssl`, `sslmode`, `sslcert`, `sslkey` and `sslrootcert` URL parameters. The service rejects conflicts that could replace explicit verification. Maintain and rotate the CA bundle; never disable verification to recover a deployment. Sources: [node-postgres SSL](https://node-postgres.com/features/ssl), [RDS certificates](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

Use ALB forwarding mode `append`, client-port preservation disabled, and task ingress restricted to ALB. The app selects the observed address rather than forged `X-Real-IP` or prepended entries. Adding CloudFront requires a separate origin-access and proxy-trust design; increasing hop count while allowing direct ALB access is unsafe. See [ALB forwarded headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html).

Secret rotation requires new tasks; [ECS does not refresh injected values automatically](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html). Session-secret rotation signs users out. Rotate the bootstrap key separately from rolling releases: tasks starting with different values can overwrite the shared bootstrap row.

## Delivery stages

1. **Local validation:** `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm pack --pack-destination dist`, then `docker build --tag postplan:local .`. CI performs these without AWS access. Pin the reviewed base image by digest and retain scanning/SBOM results before production.
2. **Infrastructure preparation:** create Terraform/CDK in the chosen infrastructure repository for the resources above, with separate staging/production state and deletion safeguards. Review its plan and cost estimate before any apply. No apply is part of this change.
3. **Delivery pipeline:** use short-lived CI OIDC credentials scoped to the environment, ECR repository, ECS service and exact `iam:PassRole` roles. Build once, scan, push and promote the same digest. Production deployment remains separately authorised. Checked-in CI validates and builds only.
4. **Staging, when authorised:** start one task against an empty database/bucket. Target type `ip`, port 3000, health path `/healthz`, expected 200, initial startup grace 120 seconds. Health checks cover PostgreSQL, not S3. Exercise two simultaneous starts: an advisory lock serialises current idempotent schema DDL. Future destructive changes need versioned expand/contract migrations.
5. **Acceptance:** run the checklist below with real staging dependencies; tune sizes, timeouts and alarms from measurements.
6. **Production cutover, after approval:** for an existing installation, freeze old-service writes, back up/restore PostgreSQL, copy all referenced objects with unchanged keys, verify row counts and content hashes, then set DNS/TLS and public URL. Preserve API-key hashes and session secret where appropriate. A domain change can change Shoo pairwise identities: test account continuity and define re-authentication/account-linking before cutover. Deploy the approved digest, rerun acceptance, then reopen writes. Skip migration for an empty installation.

## Staging acceptance

- `/healthz` returns 200; unavailable PostgreSQL returns 503. Invalid RDS CA/hostname fails rather than connecting without verification.
- CLI upload to custom `--api-url` succeeds; canonical and raw URLs return byte-identical HTML with CSP/version headers. Repeat upload, retrieve old/new versions, and exercise concurrent uploads to one draft.
- Test authenticated listing, ownership boundaries, key creation/revocation, draft disable/delete, anonymous uploads and blocked HTML against real PostgreSQL/S3.
- If sign-in is enabled, exercise broker callback, dashboard and `/cli/auth`; ensure draft subdomains cannot host account pages and sessions work across tasks.
- Forge forwarding headers and confirm the recorded source IP remains the observed client. Confirm tasks and S3 cannot be reached publicly.
- Stop a task under traffic, check draining and availability, then perform a rolling release. Validate task-role access without static keys and no secrets in logs.
- Restore a backup into a separate staging instance and verify it against retained objects. Do not expire current objects or shorten S3 history below the recovery window.

Uploads remain public and anonymous. In-process rate limits have separate budgets per task and reset on restart. Use WAF for edge-wide IP abuse control; strict per-account quotas require a shared limiter. The limiter retains identity entries in memory, so address bounded cleanup before high-volume public exposure.

## Rollback and recovery

Enable ECS deployment circuit breaker with rollback. Keep the prior task definition/image digest and redeploy it for regressions while retaining RDS/S3. Confirm schema backward compatibility per release; do not automatically reverse DDL.

During migration, DNS rollback is safe only before AWS accepts new writes, or after reconciling them. After writes reopen, freeze writes and choose reconciliation or a forward fix; DNS alone cannot preserve new drafts.

For corruption, restore RDS PITR into a new instance, recover matching S3 versions, verify references/content, then switch the database secret through a controlled deployment. Preserve affected data for investigation. Run rollback and restore drills before production acceptance.

## Inputs required before provisioning

AWS account/region, domain and wildcard preference, VPC/egress ownership, CI/IaC repository, traffic and availability/recovery objectives, existing-data migration needs, and acceptance of the external Shoo broker. These are deployment inputs, not blockers for local conversion.
