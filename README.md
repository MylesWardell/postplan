# Postplan

Postplan is a small service and CLI for publishing static HTML drafts from agents.

## Workspace

```text
apps/
  cli/             CLI source, agent skill, tsdown output in bin/
  server/          Bun host: Preact SSR, oRPC implementation, OAuth and S3
packages/
  api/             oRPC contract: HTTP routes, input/output schemas and client types
scripts/           Workspace build helpers
```

`packages/api` describes the complete API contract, including HTTP methods, paths, status codes, and validation schemas. `apps/server/src/routers` implements it using Drizzle-backed domain procedures; the OpenAPI handler exposes the contract at `/api`, for HTTP clients. Preact pages in `apps/server/src/frontend` call the implementation directly and submit native forms. There is no separate frontend application or browser JavaScript bundle.

The server follows the [Bun playground's router composition](https://github.com/middleapi/orpc/blob/main/playgrounds/bun/src/routers/index.ts):

```text
apps/server/src/
  index.ts          Bun entry point and Fetch transport wiring
  context.ts        Database/storage context type
  orpc.ts           implement(contract), public and authenticated middleware
  routers/
    index.ts        Compose the implemented contract
    account.ts      Named account procedures
    draft.ts        Named draft procedures
    api-key.ts      Named API-key procedures
  client.ts         Direct server-side caller for SSR
  db/               Drizzle connection, table schema and migration runner
  lib/              HTML policy and public URL helpers
  frontend/         Preact SSR pages and shared Layout
  instrumentation.ts Optional OTLP tracing
```

Schemas and HTTP route metadata stay in the exported `contract` from `packages/api`; server procedures only implement it. `index.ts` starts Bun when executed directly, while tests import its request handler without starting infrastructure.

## Development

Use Bun 1.3.14 and Node 22.20+. Bun manages workspace packages and runs the server; Node runs the CLI and workspace tooling. Turborepo builds dependencies before their consumers. oxfmt and oxlint run across the workspace; tsdown bundles the CLI.

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Copy `.env.example` to `.env` and configure S3-compatible storage and `DATABASE_PATH` (default `data/postplan.sqlite`). Apply reviewed migrations before starting the service:

```sh
bun run db:migrate
bun run start
```

For development, use an absolute `DATABASE_PATH` in the shell so migrations and watch mode share the same file. Build once, then run `bun run --filter @postplan/server dev`. Set environment variables in the shell or create `apps/server/.env` for Bun's automatic loading. Run source commands from `apps/server` so Bun loads its Preact JSX configuration. Shared package changes need `bun run build` to refresh their exports. Startup seeds account/key records but does not run DDL.

`bun run check` covers formatting, lint, strict types, and tests. Tests include native SQLite migration and HTTP/oRPC and SSR form integration checks, without AWS access. Use `bun run format`, `bun run lint:fix`, and `bun run db:generate` while editing. See [database migration guidance](apps/server/DATABASE.md).

Build the portable CLI tarball with `bun run pack:cli`. The executable is `apps/cli/bin/postplan.js`. This fork is not published to the package registry; the published package in the examples below remains upstream. See [CLI development](apps/cli/README.md).

## Typed API

The server follows the Fetch host pattern in the [oRPC Bun playground](https://github.com/middleapi/orpc/tree/main/playgrounds/bun), using its pinned oRPC `2.0.0-beta.35` generation. All oRPC packages must stay on the same version. Its API is still prerelease; review upgrades together with contract and transport tests.

The [contract](packages/api/src/index.ts) defines the REST routes; the server uses `OpenAPIHandler` without a manual REST dispatcher. Typed clients use `OpenAPILink` with the exported contract. Dates are ISO strings in REST JSON. Uploads return HTTP 201 for a new draft, 200 for a version, and 422 for rejected HTML. Errors use [oRPC’s standard format](https://orpc.dev/docs/error-handling): `code`, `message`, and optional `data`. Upload validation details are in `data.errors` and `data.warnings`; typed clients receive `ORPCError` without a custom decoder.

| Router    | Procedures                                                          |
| --------- | ------------------------------------------------------------------- |
| `account` | `me`                                                                |
| `drafts`  | `list`, `detail`, `upload`, `update`, `disable`, `enable`, `delete` |
| `apiKeys` | `list`, `create`, `revoke`                                          |

Protected procedures derive ownership from the bearer API key or verified session, never an input account ID. Browser session mutations require the application's exact Origin. The API is unavailable on draft subdomains. No batch handler is installed; rate limits run per procedure and are shared with the REST and dashboard adapters. Invalid bearer keys are rejected rather than falling back to anonymous uploads.

Draft updates use a synchronous SQLite immediate transaction to allocate a version, preserving unique monotonically increasing version numbers across concurrent uploads. Storage completes before the transaction starts; if S3 succeeds and the later transaction fails, the unreferenced object may remain for later cleanup.

```ts
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { contract, type ApiClient } from "@postplan/api";

const api = createORPCClient<ApiClient>(
  new OpenAPILink(contract, {
    origin: "http://localhost:3000",
    url: "/api",
    headers: { authorization: `Bearer ${token}` },
  }),
);
const { drafts } = await api.drafts.list();
```

The native Bun `routes` map mounts SSR at `/*`, the HTTP API at `/api` and `/api/*`, and health checks at `/healthz`. There is no WebSocket transport.

The OpenAPI handler uses `RequestLimitHandlerPlugin` (2 MiB after decompression), `RequestCompressionHandlerPlugin`, `ResponseCompressionHandlerPlugin`, `ResponseHeadersHandlerPlugin`, `CORSHandlerPlugin`, `EvlogHandlerPlugin`, `SmartCoercionHandlerPlugin`, and `OpenAPIReferenceHandlerPlugin`, using `ZodToJsonSchemaConverter`. Visit `/api` for the interactive reference and `/api/spec.json` for the contract-generated specification. REST uses bearer authentication; CORS permits bearer clients without credentialed cookies. Bun development mode enables HMR and browser console forwarding; SSR pages need no browser bundle.

`instrumentation.ts` follows the example's NodeSDK, auto-instrumentation and oRPC instrumentation setup. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to your collector's trace endpoint to enable export; `OTEL_SERVICE_NAME` defaults to `postplan`. The app does not assume the example's local Jaeger collector. The playground's sample planet/file/message domains and fake authentication are replaced by real draft/account procedures, Drizzle persistence and signed sessions.

HTML validation is authoritative on the server. The CLI uploads the file and reports the server's validation errors; it no longer bundles a second copy of the policy.

The shared Preact `Layout` supplies navigation and styling. The dashboard supports search, status filters, title/description edits, version history, public access controls, and confirmed deletion. `/cli/auth` creates named keys, shows each token once, and revokes keys.

## CLI

Upload a draft:

```sh
bunx postplan upload ./plan.html
```

Attach an optional stable description (a short label shown in your dashboard and `postplan list`). Re-running with `--description` updates it; omitting it leaves the existing one untouched:

```sh
bunx postplan upload ./plan.html --description "Q3 warehouse migration plan"
```

The CLI defaults to `https://postplan.dev`. Use `--api-url http://localhost:3000` for a local or custom deployment.

API keys are optional for private/admin flows. Log in interactively (opens a browser page that mints a key you paste back — works over SSH, no localhost redirect):

```sh
bunx postplan auth login
```

Or set a key directly:

```sh
bunx postplan auth set <api-key>
```

List the drafts published to your account (requires an API key). Each row shows the auto-linked git repo, latest version, total version count, and last-updated time:

```sh
bunx postplan list
```

The CLI stores optional credentials and draft mappings in `~/.postplan`.

## Environment

Required service variables:

- `AWS_S3_BUCKET_NAME`
- `AWS_DEFAULT_REGION`

Optional service variables:

- `DATABASE_PATH` - defaults to `data/postplan.sqlite`; use a persistent absolute path in production.

- `POSTPLAN_BOOTSTRAP_API_KEY` - creates or updates the bootstrap administrator key on startup.
- `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - for S3-compatible storage. On EC2, omit them to use native S3 with the instance role.
- `AWS_S3_FORCE_PATH_STYLE` - defaults to true for a custom endpoint and false for native S3.
- `TRUST_PROXY`, `CLIENT_IP_SOURCE`, `REQUEST_ID_HEADER` - configure the trusted proxy topology; use `1`, `req-ip`, and `x-request-id` behind one trusted proxy. Local direct connections should use `false` and `req-ip`.
- `POSTPLAN_PUBLIC_BASE_URL` - set to a normal base URL for `/d/<draft-id>` URLs, or a wildcard URL such as `https://*.postplan.dev` for draft subdomains.
- `POSTPLAN_SESSION_SECRET` - together with `POSTPLAN_PUBLIC_BASE_URL`, enables web sign-in (the dashboard and `/cli/auth`). If either is absent, those routes return 503 and uploads/serving are unaffected.
- `SHOO_BASE_URL` - identity broker for web sign-in (default `https://shoo.dev`).
- `MAX_HTML_BYTES`
- `UPLOAD_IP_RATE_LIMIT_WINDOW_MS`
- `UPLOAD_IP_RATE_LIMIT_MAX`
- `UPLOAD_RATE_LIMIT_WINDOW_MS`
- `UPLOAD_RATE_LIMIT_MAX`

Uploads are public by default. Bearer API keys are still used for admin endpoints and authenticated ownership flows. The bootstrap key is inserted into SQLite on startup if present.

## Dashboard & web sign-in

With `POSTPLAN_SESSION_SECRET` set, `/dashboard` lists the signed-in account's drafts (with search, descriptions and version history) and `/cli/auth` mints API keys for `postplan auth login`. Sign-in is delegated to [shoo](https://github.com/pingdotgg/shoo) — postplan is auto-registered as a client by its origin, exchanges the OAuth code server-side (PKCE S256), verifies the ES256 `id_token` against shoo's JWKS, and keys accounts off the stable `pairwise_sub` claim (stored in the `identities` table). Postplan then runs its own 30-day HMAC-signed session cookie; it never sees Google credentials. Dashboard pages are apex-domain only — draft subdomains cannot serve them.

Sign-in requests shoo's `pii` consent, so each user approves sharing their email, name, and profile picture once. Those claims are stored on `identities` and overwritten from the token at every login — removing your picture or email at Google clears it here too (only the stable `pii_subject` identifier is retained across logins). The header shows the email or account name. To find the email behind an upload, join `draft_versions.created_by_api_key_id → api_keys.account_id → identities.email` — nothing is denormalized onto version rows. Declining consent denies the sign-in.

An uploaded draft is attributed to whichever account's API key published it (anonymous uploads still work and stay public, but are not attributed to any account). `GET /api/drafts` returns the authenticated account's drafts — newest first, with each draft's description, auto-linked git repo, latest version number, and total version count — which is what `postplan list` and the dashboard read.

Each uploaded version records provenance and audit metadata: the client IP and request ID from the configured proxy topology, git branch/commit/subject and working-tree state, CI run URL and actor, and content signals (inline scripts and external image hosts). Git and CI values are self-reported and used for display and audit only, never authorization. Defaults retain Railway headers; AWS settings are documented in the deployment plan.

Uploaded HTML may contain inline classic JavaScript (`<script>...</script>`). External script sources, module scripts, inline event-handler attributes, JavaScript URLs, forms, iframes/embeds, and meta-refresh redirects are rejected at upload time. That upload-time policy is the safeguard; once stored, a draft is served verbatim.

## Serving

Every draft URL serves the exact uploaded HTML, byte for byte, to every client — browsers, `curl`, agent fetch tools, and HTTP libraries alike. There is no browser detection, no wrapper page, and no consent interstitial: a draft URL is just its HTML, so an agent that fetches one always gets the content a user uploaded. Responses carry `X-Postplan-Draft-Id` and `X-Postplan-Draft-Version` headers.

Responses also set a Content-Security-Policy. The CSP never changes the bytes a client reads, so it does not gate content for `curl` or agents in any way; it only constrains what the page may do if a human opens it in a browser — `script-src 'none'` blocks script execution, `connect-src 'none'` blocks network requests, and `form-action 'none'` blocks form posts.

The upload API returns both `publicUrl` and `rawUrl`, and the CLI prints the raw URL as `Raw HTML`. With wildcard draft domains the raw URL uses the stable apex form (`https://postplan.dev/d/<draft-id>/raw`). The `/raw` suffix is an alias kept for the API and CLI; it serves the same bytes as the canonical URL:

- `https://<draft-id>.postplan.dev/` (or `/raw`)
- `https://<draft-id>.postplan.dev/v/<n>/raw`
- `https://postplan.dev/d/<draft-id>/raw`
- `https://postplan.dev/d/<draft-id>/v/<n>/raw`

## AWS deployment preparation

See [the AWS deployment plan](docs/aws-deployment-plan.md) for the proposed single EC2 instance, persistent SQLite volume and S3 architecture, runtime settings, IAM boundaries, staging acceptance, migration and rollback. No AWS resources have been deployed.

```sh
docker build --tag postplan:local .
```

The image runs compiled JavaScript with Bun as a non-root user with SQLite on a persistent `/data` mount. CI checks formatting, lint, types, tests, CLI packaging and the container build; it has no AWS deployment step.

The CLI uses `OpenAPILink` with `RequestValidationLinkPlugin(contract)` and `RequestCompressionLinkPlugin`. Browser SSR forms use `parseFormData` and `getIssueMessage` from oRPC's form helpers. Bun's body limit covers native SSR form requests; API bodies are additionally limited after decompression by oRPC.

Request validation checks contract input, not proxy trust. `http/client-ip.ts` retains trusted-hop resolution for audit and rate-limit keys. Static File serves local directories; it is not enabled because this app has no local asset directory and its drafts require database checks before S3 retrieval.
