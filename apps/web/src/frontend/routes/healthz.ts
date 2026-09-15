import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: async ({ context }) => {
        try {
          await context.deps.store.health();
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
