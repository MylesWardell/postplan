import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: async ({ context }) => {
        try {
          await context.deps.db.get(sql`select 1`);
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
