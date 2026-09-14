# Postplan

Postplan is a small service and CLI for publishing static HTML drafts from agents.

## Workspace

```text
apps/
  cli/             CLI source, agent skill, tsdown output in bin/
  server/          Bun host: Preact SSR, oRPC implementation, OAuth and S3
packages/
  api/             oRPC contract: HTTP routes, input/output schemas and client types
  core/            Shared HTML policy and public URL construction
  database/        Drizzle schema, PostgreSQL access and versioned migrations
scripts/           Workspace build helpers
```

`packages/api` describes the complete API contract, including HTTP methods, paths, status codes, and validation schemas. `apps/server/src/routers` implements it using Drizzle-backed services; the OpenAPI handler exposes the contract at `/api`, and the RPC handler at `/rpc`. Preact pages in `apps/server/src/views` call the implementation directly and submit native forms. There is no separate frontend application or browser JavaScript bundle.

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
  services/         Drizzle-backed business operations
  views/            Preact SSR pages and shared Layout
```

Schemas and HTTP route metadata stay in the exported `contract` from `packages/api`; server procedures only implement it. `index.ts` starts Bun when executed directly, while tests import its request handler without starting infrastructure.

## Development

Use Node 22.20+, Bun 1.3.14, and pnpm 11.22.0. Bun runs the server; Node runs the CLI and workspace tooling. Turborepo builds dependencies before their consumers. oxfmt and oxlint run across the workspace; tsdown bundles the CLI.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Copy `.env.example` to `.env` and configure PostgreSQL and S3-compatible storage. Apply reviewed migrations before starting the service:

```sh
pnpm db:migrate
bun --env-file=.env apps/server/dist/src/index.js
```

For development, build once, then run `pnpm --filter @postplan/server dev`. Set environment variables in the shell or create `apps/server/.env` for Bun's automatic loading. Run source commands from `apps/server` so Bun loads its Preact JSX configuration. Shared package changes need `pnpm build` to refresh their exports. Startup seeds account/key records but does not run DDL.

`pnpm check` covers formatting, lint, strict types, and tests. Tests include embedded PostgreSQL migration and HTTP/oRPC and SSR form integration checks, without AWS access. Use `pnpm format`, `pnpm lint:fix`, and `pnpm db:generate` while editing. See [database migration guidance](packages/database/README.md).

Build the portable CLI tarball with `pnpm pack:cli`. The executable is `apps/cli/bin/postplan.js`. This fork is not published to the package registry; the published package in the examples below remains upstream. See [CLI development](apps/cli/README.md).

## Typed API

The server follows the Fetch host pattern in the [oRPC Bun playground](https://github.com/middleapi/orpc/tree/main/playgrounds/bun), using its pinned oRPC `2.0.0-beta.35` generation. All oRPC packages must stay on the same version. Its API is still prerelease; review upgrades together with contract and transport tests.

The [contract](packages/api/src/index.ts) defines the REST routes; the server uses `OpenAPIHandler` without a manual REST dispatcher. `RPCHandler` exposes the same implementation for typed oRPC clients. Dates are native `Date` values over RPC and ISO strings in REST JSON. Uploads return HTTP 201 for a new draft, 200 for a version, and 422 with validation errors for rejected HTML.

| Router    | Procedures                                                          |
| --------- | ------------------------------------------------------------------- |
| `account` | `me`                                                                |
| `drafts`  | `list`, `detail`, `upload`, `update`, `disable`, `enable`, `delete` |
| `apiKeys` | `list`, `create`, `revoke`                                          |

Protected procedures derive ownership from the bearer API key or verified session, never an input account ID. Browser session mutations require the application's exact Origin. The API is unavailable on draft subdomains. No batch handler is installed; rate limits run per procedure and are shared with the REST and dashboard adapters. Invalid bearer keys are rejected rather than falling back to anonymous uploads.

Draft updates lock the owned draft row before allocating a version, preserving unique monotonically increasing version numbers across concurrent uploads. Database writes roll back on storage failure; if S3 succeeds and the later transaction fails, the unreferenced object may remain for later cleanup.

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiClient } from "@postplan/api";

const api = createORPCClient<ApiClient>(
  new RPCLink({
    origin: "http://localhost:3000",
    url: "/rpc",
    headers: { authorization: `Bearer ${token}` },
  }),
);
const { drafts } = await api.drafts.list();
```

The shared Preact `Layout` supplies navigation and styling. The dashboard supports search, status filters, title/description edits, version history, public access controls, and confirmed deletion. `/cli/auth` creates named keys, shows each token once, and revokes keys.

## CLI

Upload a draft:

```sh
pnpm dlx postplan upload ./plan.html
```

Attach an optional stable description (a short label shown in your dashboard and `postplan list`). Re-running with `--description` updates it; omitting it leaves the existing one untouched:

```sh
pnpm dlx postplan upload ./plan.html --description "Q3 warehouse migration plan"
```

The CLI defaults to `https://postplan.dev`. Use `--api-url http://localhost:3000` for a local or custom deployment.

API keys are optional for private/admin flows. Log in interactively (opens a browser page that mints a key you paste back — works over SSH, no localhost redirect):

```sh
pnpm dlx postplan auth login
```

Or set a key directly:

```sh
pnpm dlx postplan auth set <api-key>
```

List the drafts published to your account (requires an API key). Each row shows the auto-linked git repo, latest version, total version count, and last-updated time:

```sh
pnpm dlx postplan list
```

The CLI stores optional credentials and draft mappings in `~/.postplan`.

## Environment

Required service variables:

- `DATABASE_URL`
- `AWS_S3_BUCKET_NAME`
- `AWS_DEFAULT_REGION`

Optional service variables:

- `POSTPLAN_BOOTSTRAP_API_KEY` - creates or updates the bootstrap administrator key on startup.
- `DATABASE_SSL_CA_FILE` - PEM CA bundle for verified PostgreSQL TLS; omit conflicting SSL parameters from `DATABASE_URL`.
- `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - for S3-compatible storage. On ECS, omit them to use native S3 with the task role.
- `AWS_S3_FORCE_PATH_STYLE` - defaults to true for a custom endpoint and false for native S3.
- `TRUST_PROXY`, `CLIENT_IP_SOURCE`, `REQUEST_ID_HEADER` - configure the trusted proxy topology; use `1`, `req-ip`, and `x-amzn-trace-id` behind a direct ALB. Local direct connections should use `false` and `req-ip`.
- `POSTPLAN_PUBLIC_BASE_URL` - set to a normal base URL for `/d/<draft-id>` URLs, or a wildcard URL such as `https://*.postplan.dev` for draft subdomains.
- `POSTPLAN_SESSION_SECRET` - together with `POSTPLAN_PUBLIC_BASE_URL`, enables web sign-in (the dashboard and `/cli/auth`). If either is absent, those routes return 503 and uploads/serving are unaffected.
- `SHOO_BASE_URL` - identity broker for web sign-in (default `https://shoo.dev`).
- `MAX_HTML_BYTES`
- `UPLOAD_IP_RATE_LIMIT_WINDOW_MS`
- `UPLOAD_IP_RATE_LIMIT_MAX`
- `UPLOAD_RATE_LIMIT_WINDOW_MS`
- `UPLOAD_RATE_LIMIT_MAX`

Uploads are public by default. Bearer API keys are still used for admin endpoints and authenticated ownership flows. The bootstrap key is inserted into Postgres on startup if present.

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

See [the AWS deployment plan](docs/aws-deployment-plan.md) for the proposed ECS Fargate, ALB, RDS and S3 architecture, runtime settings, IAM boundaries, staging acceptance, migration and rollback. No AWS resources have been deployed.

```sh
docker build --tag postplan:local .
```

The image runs compiled JavaScript with Bun as a non-root user and includes the RDS CA bundle. CI checks formatting, lint, types, tests, CLI packaging and the container build; it has no AWS deployment step.
