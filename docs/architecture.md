# Architecture and API

## Application structure

`packages/api` defines the public oRPC contract, including HTTP routes, status codes, schemas, and client types. `apps/web/src/routers` implements it through the provider-independent `@postplan/store` client. `packages/store` defines internal account/draft store contracts; `packages/store-drizzle` and `packages/store-dynamodb` implement them with Drizzle/SQLite and DynamoDB respectively. Backend selection happens at startup. Keep every oRPC package on the pinned `2.0.0-beta.35` generation and review upgrades with the contract and transport tests.

Hono is the shared HTTP server framework for Bun, Lambda and Cloudflare. It routes `POST /api/uploads` directly to schema validation and the store upload operation, returning plain JSON without the oRPC HTTP handler/plugin pipeline. The other API paths retain oRPC, and the upload contract remains available to typed clients and OpenAPI documentation. Uploads preserve bearer authentication, IP/key quotas and rate-limit headers, request IDs, CORS, bounded JSON/decompression, and the existing TypeScript HTML policy. Runtime adapters retain their gateway, storage-budget and static-asset handling.

TanStack Start owns page file routing, SSR, hydration, and server functions behind the Hono fallback. Routes and their data functions live in `apps/web/src/frontend/routes`. Server-side functions call oRPC directly; browser navigation uses Start's generated endpoints.

```text
apps/web/src/
  index.ts          Bun host and static assets
  server.ts         Runtime initialization and request dependencies
  application.ts    Shared Hono router: direct upload, oRPC API, pages
  context.ts        Store client and HTML storage context
  orpc.ts           Contract implementation and middleware
  routers/          Account, draft, and API-key procedures
  client.ts         Direct server-side caller for SSR
  db/               Provider selection and maintenance entry points
  lib/              HTML policy and public URL helpers
  frontend/         Router, page routes, layouts, and styles
  instrumentation.ts Optional OTLP tracing
```

The root route owns the document shell. A fresh router is created for each SSR request, with authentication stored in router context. Protected loaders and form actions also verify the session on the server. Application hydration scripts receive a per-response CSP nonce.

## HTTP API

The API is mounted at `/api`; `/api/spec.json` serves the generated OpenAPI document and `/api` serves the interactive reference. Draft subdomains cannot access application or API routes.

| Router    | Procedures                                                                    |
| --------- | ----------------------------------------------------------------------------- |
| `account` | `me`                                                                          |
| `drafts`  | `list`, `totals`, `detail`, `upload`, `update`, `disable`, `enable`, `delete` |
| `apiKeys` | `list`, `create`, `revoke`                                                    |

Protected procedures derive ownership from a bearer key or verified browser session. They do not accept an account ID from the client. Session mutations require the application's exact Origin, and invalid bearer keys fail instead of falling back to anonymous access.

The server uses oRPC's standard error shape: `code`, `message`, and optional `data`. Uploads return 201 for a new draft, 200 for a new version, and 422 when HTML validation fails. REST dates use ISO strings.

`drafts.list` (`GET /api/drafts`) returns one page ordered by most recently updated. It accepts `limit` (default 50, maximum 100), `q` (case-insensitive ASCII search of title, description and repository name), `status` (`all`, `published` or `disabled`) and the opaque `cursor` from the previous page's `nextCursor`. `nextCursor` is `null` on the last page. `drafts.totals` (`GET /api/drafts/totals`) returns account-wide draft, published and saved-version counts.

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

const { drafts, nextCursor } = await api.drafts.list({ limit: 100 });
```

Draft updates store HTML before opening a synchronous SQLite immediate transaction. The transaction allocates a unique increasing version number and writes the database records. A database failure after storage succeeds can leave an unreferenced object for later cleanup.

## HTML policy and serving

The server validates every upload. It permits inline classic scripts but rejects external and module scripts, inline event handlers, JavaScript URLs, forms, frames, embeds, and meta refresh. Stored drafts are then served byte for byte without browser detection or wrapper markup.

Draft responses include `X-Postplan-Draft-Id` and `X-Postplan-Draft-Version`. Their Content Security Policy blocks script execution, network connections, and form submission when a person opens a draft in a browser. The policy does not alter the HTML returned to command-line tools or agents.

The upload response includes `publicUrl` and `rawUrl`. The `/raw` routes are aliases for the same bytes:

- `https://<draft-id>.postplan.dev/`
- `https://<draft-id>.postplan.dev/v/<n>/raw`
- `https://postplan.dev/d/<draft-id>/raw`
- `https://postplan.dev/d/<draft-id>/v/<n>/raw`

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to export traces. `OTEL_SERVICE_NAME` defaults to `postplan`.
