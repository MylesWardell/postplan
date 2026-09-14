# Frontend workspace

This workspace reserves the draft-management application boundary. It currently provides a typed tRPC client; it does not yet contain a UI or a development server. The existing dashboard remains served by `apps/server`.

```ts
import { createDraftsClient } from "./src/index.js";

const api = createDraftsClient();
const { drafts } = await api.drafts.list.query();
await api.drafts.update.mutate({ draftId: drafts[0]!.draftId, description: "Reviewed" });
```

Import `AppRouter` from `@postplan/api` with `import type`. Database and server code must not be runtime dependencies of the browser bundle. Queries serialize dates as ISO strings using tRPC's default JSON transport.

Serve the future frontend on the same origin as `/trpc`, `/auth/*`, and `/cli/auth`; use a development proxy when adding a UI framework. Browser calls use the existing HttpOnly session cookie. Mutation requests require an `Origin` matching the configured application origin. Uploading HTML requires a CLI/API key; the frontend can manage existing drafts and mint/revoke keys without exposing server credentials.
