# Cloudflare compatibility experiment

This spike runs the real TanStack Start homepage and oRPC specification on Workers, with D1 health, native R2 storage and a SQLite Durable Object limiter. Account, draft, authentication and upload application routes remain disabled; the D1 Store adapter is not implemented. The existing Bun/AWS entry points keep their default behavior.

From the repository root (after `bun install`):

```powershell
bun run --filter @postplan/server cf:types
bunx --no-install turbo run cf:build cf:test --filter=@postplan/server
bunx --no-install tsc -p apps/server/cloudflare/tsconfig.json
```

Run the built artifact locally from `apps/server`:

```powershell
$env:EXPERIMENT_TOKEN = 'local-test-only'
bunx --no-install wrangler dev --config cloudflare/dist/server/wrangler.json --port 5173 --local
```

In another terminal, from the root:

```powershell
$env:EXPERIMENT_TOKEN = 'local-test-only'
bun apps/server/cloudflare/http-check.ts
```

The HTTP check uses two storage probes. Set `POSTPLAN_EXPERIMENT_URL` to test a deployed instance. The timings it reports are wall time, not CPU time. Vitest resets its isolated storage after each test; local Wrangler storage persists.

## Remote configuration and credentials

The checked-in Wrangler configuration is local-only: its D1 ID is a placeholder. Create an ignored `cloudflare/generated/wrangler.remote.json` from it, using `main: "../worker.ts"`, the intended Worker name, actual D1/R2 bindings, an exact HTTPS public URL and `EXPERIMENT_LOCAL: "false"`. Select it at build time through `POSTPLAN_CLOUDFLARE_CONFIG=cloudflare/generated/wrangler.remote.json`, then deploy the generated `cloudflare/dist/server/wrangler.json`. Rebuild when configuration changes; deploy-time environment flags do not retarget this artifact.

Root `.env.cloudflare.local` holds CLI-only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Load those values into the Wrangler process environment without printing them. Do not pass this credential file to Worker secrets or Vite environment loading. Generate a separate random `EXPERIMENT_TOKEN` and pass an ignored file containing only that secret through Wrangler's `--secrets-file` option. Check the final artifact for credentials before upload.

Keep the Worker on Free and the R2 bucket private with Standard storage. Do not enable WAF or paid upgrades for this experiment. Check account-wide remaining allowances before remote tests; R2 is usage billed beyond its allowance, and this application's budget cannot constrain unrelated account activity.

## Bounded storage probes

`POST /__experiment/probe` requires the experiment bearer secret and accepts at most 512 KiB. An atomic D1 counter admits at most 20 valid probes over the database's lifetime. Reservations are consumed even if later I/O fails, and do not reset on retry, time boundaries or redeployment. Each admitted probe performs one R2 put, one get and a finally-block delete, plus three limiter calls. At most 10 MiB can be written through this endpoint over its lifetime. Public routes cannot read or write R2.

The budget fails closed when D1 fails or the counter is exhausted. Deleting/resetting the database removes this protection, so never reset it remotely just to rerun tests. A failed delete can leave an object; verify bucket emptiness afterward. Disable workers.dev and preview URLs after testing and retain that setting in the remote source configuration.

The [GitHub usage guard](../../../scripts/cloudflare/README.md) adds hourly account usage checks and a manual kill switch. It persists a D1 stop flag checked by probe reservations, disables public access and never automatically restores service. Scheduling starts only after merge to `master`.

## Results: 14 September 2026

- Nine workerd tests passed: gateway normalization, D1 rollback and conditional writes, R2 round trip, limiter concurrency/isolation/eviction/alarms, authentication/crypto, and concurrent lifetime budget exhaustion.
- Existing repository `bun run check` passed, including regeneration of ignored Worker types; Cloudflare TypeScript and Vite build passed.
- Local and remote HTTP checks passed: SSR/CSP, D1 health, parseable OpenAPI JSON, static CSS, disabled data routes, secret rejection, 85-byte and 524,288-byte HTML, and oversized-body rejection.
- Deployed to the user-created `postplan-clone` Worker; version `5ad9e0e6-c2ca-40a7-a74f-b5ba9be5f6f0`. Packaging: 1,797.74 KiB raw, 405.87 KiB gzip; startup reported 39 ms.
- Remote probe wall times were 1,680 ms and 868 ms respectively. These are two observations, not latency percentiles or CPU measurements.
- Remote D1 confirms two consumed reservations and a 16 KiB database. R2 reports zero objects and zero bytes afterward. workers.dev and preview URLs were verified disabled. The empty bucket, small database and Worker remain for later experiments.

Application response compression must be disabled on this Worker: local workerd returned gzip OpenAPI bytes without a Content-Encoding header when the oRPC response compression plugin was active. The portable factory retains compression by default for existing runtimes.

The limiter intentionally starts a fixed window per subject and persists it. The existing in-memory implementation uses a shared process epoch; this boundary difference needs a rollout decision. D1 batches roll back on SQL errors, but a zero-row conditional update does not stop later statements: the full adapter must guard every dependent write.

Full Store behavior, Shoo browser login, wildcard draft hosts, retention, backup/restore, CPU percentiles and sustained account-wide free-tier headroom remain unverified. See the [deployment plan](../../../docs/cloudflare-deployment-plan.md).
