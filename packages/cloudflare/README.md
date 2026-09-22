# Cloudflare

Runs the shared Astro/Hono application on Workers with D1, private R2 storage and a Durable Object rate limiter. `src/` contains the runtime adapters; `deploy/` initializes storage; `test/` contains Worker tests.

## Local development

After `bun install --frozen-lockfile`, run from the repository root:

```powershell
bun run --filter @postplan/cloudflare cf:types
bunx --no-install turbo run cf:build cf:test --filter=@postplan/cloudflare
cd packages/cloudflare
$env:POSTPLAN_RATE_LIMIT_SECRET = 'local-test-only'
$env:POSTPLAN_BOOTSTRAP_API_KEY = 'local-application-test'
bun deploy/initialize.ts --local
bunx --no-install wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/state --port 5173 --local --var POSTPLAN_APPLICATION_ENABLED:true --var POSTPLAN_SESSION_SECRET:local-session-only
```

Run `bun packages/cloudflare/test/http.ts` from another terminal at the repository root for local HTTP checks. Initialization applies migrations and seeds missing accounts without resetting keys, budgets or the stop latch.

## Deployment

`wrangler.jsonc` is for local development. `wrangler.production.jsonc` selects the production Worker and storage bindings. For your own deployment, update its account, Worker, D1 and R2 identifiers and the [usage policy](usage/usage-policy.json).

Before deploying, open the Worker in the Cloudflare dashboard â†’ **Settings â†’ Variables and Secrets**. Set these as **Secret** values:

- `POSTPLAN_RATE_LIMIT_SECRET`: a random rate-limit signing secret.
- `POSTPLAN_SESSION_SECRET`: an independent random session signing secret.
- `POSTPLAN_PUBLIC_BASE_URL`: the deployment's HTTPS URL.

To restrict a private server, optionally add `POSTPLAN_ALLOWED_LOGIN_EMAILS` as a Secret containing the allowed addresses, comma-separated. Without login access rules, any Shoo user can sign in.

Replace any existing plaintext binding with a Secret of the same name. Keep personal addresses out of Wrangler `vars`, build variables and command arguments. The three secrets listed above are required by the production config; the login allowlist is optional. Wrangler preserves dashboard secrets across deployments. See [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

From the repository root:

```sh
bunx --no-install turbo run cf:build:production --filter=@postplan/cloudflare
bun run --filter @postplan/cloudflare cf:deploy:production
```

Use those same build and deploy commands in Workers Builds, with `/` as the root directory. The build generates `packages/cloudflare/dist/server/wrangler.json`; configuration changes require rebuilding. For first-time storage initialization, set `POSTPLAN_CLOUDFLARE_CONFIG=wrangler.production.jsonc` and run `bun deploy/initialize.ts --remote` from this package with your Cloudflare credentials in the environment.

## Limits and cleanup

`MAX_HTML_BYTES` controls upload size; production defaults to 32 KiB. Storage reservations are lifetime limits: 2,000 writes, 1 GiB of uploaded HTML and 250,000 reads. Failed operations can consume reservations; deletion does not refund them. A stop latch or exhausted budget blocks storage access.

`PLAN_RETENTION_DAYS` defaults to 90; `0` disables automatic expiry. Add an hourly Cron trigger (`0 * * * *`) to run cleanup. Each invocation handles up to 25 plans and 25 versions. The [usage guard](usage/README.md) can stop traffic and cleanup; redeploying does not clear its D1 latch.

See [configuration](../../docs/configuration.md) for login rules and [benchmarks](../../benchmark/cloudflare/README.md) for local CPU measurements.
