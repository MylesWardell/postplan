# Minimal upload Worker

Opt-in Cloudflare upload experiment: a module-scope Hono router exposes only `POST /api/uploads`. It uses native D1/R2 bindings and a private HTML-validator service. The existing application continues to serve documents and dashboards.

Three entrypoints share the same upload implementation:

- `src/worker.ts`: Hono and direct Zod input/output validation (default).
- `src/bare.ts`: bare fetch control with the same validation.
- `src/orpc.ts`: Hono plus one oRPC OpenAPI procedure, using the same schemas.

All variants enforce authentication, a required test-account allowlist, the application stop flag, DO IP/key quotas, ownership, and lifetime storage reservations. HTML is limited to 32 KiB and parsed-tree depth below 64; the JSON request limit remains 2 MiB. The validator must succeed before reserving storage or writing R2. A failed write does not refund its reservation. D1 atomically allocates version numbers and updates metadata; an R2 object can remain orphaned if the later D1 transaction fails.

Successful response schemas match the existing upload API. Error envelopes differ between direct and oRPC adapters. This is an experimental upload endpoint, not a replacement for all application routes or a production rollout.

## Build and test

From the repository root, install with `bun install --frozen-lockfile` and build dependencies with `bunx --no-install turbo run build --filter=@postplan/store --filter=@postplan/api`. Then:

```sh
cd packages/html-validator
bun run rust:test
bun run validator:test
bun run worker:build
cd ../cloudflare-upload
bun run typecheck
bun run cf:build
bun run upload:test
```

Acceptance tests run all three entrypoints in workerd with the real Rust validator and Durable Object limiter, local D1 and local R2. They cover successful uploads, concurrent updates, stored bytes/metadata, malformed and rejected input, authorization, ownership, kill switch, budgets and failed metadata transactions.

## Deployed experiment

The tracked Wrangler configuration is disabled, private and contains placeholder storage identifiers. Create ignored configurations under `generated/` with explicit test D1/R2 resources, a private validator service, an existing RateLimit Durable Object binding, public document base URL and a disposable account ID. Set a fresh `POSTPLAN_RATE_LIMIT_SECRET`, enable uploads only for that account, and deliberately enable the temporary ingress for the benchmark. Do not overwrite the main Worker.

Keep credentials in an ignored file. `benchmark/run.mjs` takes an array of `{name,url,token}` in bare, hono, orpc order and a new ignored result filename:

```sh
node packages/cloudflare-upload/benchmark/run.mjs .local/arms.json .local/requests.json
```

One run sends 54 interleaved requests. Allow the shared 60-per-minute IP window to expire between runs. Retain startup samples and failures. Match response Ray IDs to Cloudflare invocation logs for CPU time; client elapsed time is not CPU. Revoke temporary keys, disable ingress and delete only the recorded synthetic objects afterward; retain budget counters and audit rows. See [benchmark results](../../docs/hono-upload-benchmark.md).

## Hono body handling

The common bounded reader consumes the incoming body and constructs one fresh Request from those bytes before either JSON parsing or oRPC dispatch. oRPC therefore receives an unread body. No Hono body middleware runs before it. This avoids the [Body Already Used error](https://orpc.dev/docs/adapters/hono#body-already-used-error) without reserializing JSON or hiding consumed-body state behind a proxy.
