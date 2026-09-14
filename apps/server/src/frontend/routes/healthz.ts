import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { isDynamoDatabase } from "#db/dynamo";
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: async ({ context }) => {
        try {
          if (isDynamoDatabase(context.deps.db)) {
            await context.deps.db.health();
          } else {
            await context.deps.db.get(sql`select 1`);
          }
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
