# Cloudflare application connector

The [optimization investigation](../../docs/cloudflare-optimization-investigation.md) includes the latest remote CPU comparison. The current build still exceeds Workers Free's CPU allowance on dashboard renders and uploads; public access remains disabled.

The selectable Worker serves the shared API and TanStack Start dashboard using D1, private R2 Standard storage and a SQLite Durable Object limiter. Application routes are opt-in with `POSTPLAN_APPLICATION_ENABLED=true`; the checked-in configuration keeps them disabled. The existing remote experiment remains stopped.

## Package layout

- `src/`: Worker, gateway, D1/R2 adapters, limiter and cleanup.
- `deploy/`: repeatable schema and account initialization.
- `test/`: permanent workerd, HTTP acceptance and usage-guard regression tests.
- `usage/`: operational account monitor and kill switch.
- Root configuration: Wrangler, Vite, Vitest and TypeScript.

One-off probes and CPU investigation scripts are kept outside the package in gitignored `.local/cloudflare/`. The experimental probe endpoint has been removed. `generated/` contains only ignored deployment inputs and generated bootstrap SQL; runtime code never imports it.

## Local application

From the repository root, after `bun install`:

```powershell
bun run --filter @postplan/cloudflare cf:types
bunx --no-install turbo run cf:build cf:test --filter=@postplan/cloudflare
bunx --no-install tsc -p packages/cloudflare/tsconfig.json
cd packages/cloudflare
$env:POSTPLAN_RATE_LIMIT_SECRET = 'local-test-only'
$env:POSTPLAN_BOOTSTRAP_API_KEY = 'local-application-test'
bun deploy/initialize.ts --local
bunx --no-install wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/state --port 5173 --local --var POSTPLAN_APPLICATION_ENABLED:true --var POSTPLAN_SESSION_SECRET:local-session-only
```

In another terminal, run `bun packages/cloudflare/test/http.ts` from the root. It creates synthetic local plans, verifies authentication, versions, public HTML, dashboard sessions/CSP, key revocation, disable/enable/delete and body limits. It cannot target a remote URL. CI also sets the local stop latch, reruns initialization and verifies that the dashboard remains stopped.

Initialization applies shared Drizzle migrations, creates Cloudflare budget tables and inserts missing initial accounts. Existing keys, consumed budgets and the stop latch are preserved. The optional bootstrap API key is hashed before writing ignored SQL. Do not use the example credentials remotely. Local initialization, Vite development and built-Worker testing share this package's `.wrangler/state`; remote bindings are disabled in the Vite plugin.

## Runtime boundaries

`POSTPLAN_RUNTIME=cloudflare` selects this package's Vite plugin and Worker entry; unset or `aws` selects Bun/Lambda. AWS supports exactly one of `POSTPLAN_DATABASE=sqlite` or `dynamodb`; Cloudflare accepts only `sqlite`, implemented through D1. Unsupported selections fail. Legacy AWS database detection remains available when no database is explicitly selected.

This package owns the gateway, D1 driver, R2 adapter, Durable Object limiter, initialization, cleanup, tests and usage guard. `packages/lambda` owns AWS adapters. `apps/web` consumes injected Store and HTML storage interfaces. Shared `packages/store-drizzle` queries and migrations do not import Cloudflare; its portable database interface supports asynchronous reads and atomic SQL batches. Bun SQLite uses the explicit `/client` subpath.

Build output stays in `packages/cloudflare/dist` for Cloudflare and `apps/web/dist` for AWS. Each build clears its output to avoid accumulating obsolete Worker chunks. Routers are constructed once per isolate; per-request context remains isolated. Worker response compression is disabled because workerd stripped the oRPC plugin's encoding header in compatibility testing.

The Worker registers oRPC's experimental `CloudflareTracer` once at module scope. Procedure and middleware spans use Workers Traces with the configured 1% sampling rate; the AWS OpenTelemetry SDK is not loaded. `enable_request_signal` lets oRPC observe client disconnects through the request signal. Keep both the compatibility flag and trace settings in generated remote configurations. Tracing adds diagnostic overhead and does not establish compliance with the Free CPU allowance.

## Storage and retention safeguards

Before every application R2 operation, D1 atomically consumes a lifetime reservation:

| Limit                     | Value                          |
| ------------------------- | ------------------------------ |
| HTML per version          | 512 KiB UTF-8                  |
| Request body              | 2 MiB, counted while streaming |
| Total R2 puts             | 2,000                          |
| Total reserved HTML bytes | 1 GiB                          |
| Total R2 gets             | 250,000                        |

Reservations are never automatically refunded or renewed, including after failed writes, deletion, restarts or initialization. At 100 uploads/month the write allowance lasts about 20 months; failures consume it too. Exhaustion or a stop latch rejects storage access before R2 I/O. Database failures fail closed. These limits cover application access to an exclusive private bucket, not manual writes or other account workloads.

The scheduled handler marks up to 25 expired plans and deletes up to 25 versions per invocation. `PLAN_RETENTION_DAYS` defaults to 90; `0` disables expiry. Expired plans stop being publicly readable immediately, independently of cleanup timing. Deleted plans have a 60-second grace period before object removal; tombstones and lifetime reservations remain. Failed database commits can leave orphan objects: they stay charged against the lifetime budget. Automatic orphan reconciliation and recoverable upload intents remain rollout work.

No Cron trigger is enabled by default. When activating a reviewed deployment, configure an hourly trigger (`0 * * * *`) for cleanup. The stop latch also prevents scheduled cleanup. The [GitHub usage guard](./usage/README.md) checks account usage hourly and supports a manual kill switch; it latches D1, disables public exposure and removes Cron triggers without automatically restoring service. Its schedule starts after merge to `master`. Analytics and GitHub scheduling can lag, so the cron is not a billing hard cap.

## Remote configuration

The source Wrangler configuration is local-only, with a placeholder D1 ID. Use an ignored `generated/wrangler.remote.json` with the intended resource identities, `main: "../src/worker.ts"`, migrations path `../../store-drizzle/drizzle`, exact HTTPS public URL and `POSTPLAN_LOCAL: "false"`. Select it through `POSTPLAN_CLOUDFLARE_CONFIG`, initialize using `bun deploy/initialize.ts --remote`, then build and deploy the generated `dist/server/wrangler.json`. Configuration changes require rebuilding.

Root `.env.cloudflare.local` contains CLI-only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Load them into the CLI environment without printing them; never use that file as Worker secrets. Configure independent random Worker secrets for `POSTPLAN_RATE_LIMIT_SECRET` and `POSTPLAN_SESSION_SECRET`, plus the intended login-domain settings. Supply the bootstrap key only during initialization. Keep secrets out of checked-in vars and command arguments.

Keep Workers Free and R2 private Standard. Do not enable paid WAF or upgrade the plan. Validate account-wide headroom before any remote experiment. Enabling application routes does not clear an existing stop latch; recovery requires a separate deliberate operation after checking usage and exposure settings.

## Validation and remaining acceptance

Local repository checks, both runtime builds, Cloudflare TypeScript, 16 workerd tests and 15 usage-guard tests pass. The built Worker passes the application check and persistent-stop check. Tests cover concurrency, rollback, ownership/deletion races, account lifecycle, limiter isolation, budget exhaustion, UTF-8 sizes, expiry and cleanup.

The [bounded remote CPU test](../../docs/cloudflare-cpu-test.md) deployed this connector on Workers Free on 14 September 2026. Dashboard rendering and uploads repeatedly exceeded 10 ms, so the current build does not reliably fit the Free CPU allowance. All temporary HTML was deleted and verified absent; the test key was revoked and the remote stop restored. The tested version remains deployed with public access disabled. Shoo browser login, wildcard DNS, backup/restore and cleanup CPU remain unverified. See the [usage assessment](../../docs/cloudflare-usage-assessment.md) and [deployment plan](../../docs/cloudflare-deployment-plan.md).

The package cleanup renames `EXPERIMENT_TOKEN` to `POSTPLAN_RATE_LIMIT_SECRET` and `EXPERIMENT_LOCAL` to `POSTPLAN_LOCAL`. Supply the rate-limit secret before deploying the new entry; reusing its previous value preserves limiter subject names. Historical probe counters are retained in D1 but no longer have a public endpoint.
