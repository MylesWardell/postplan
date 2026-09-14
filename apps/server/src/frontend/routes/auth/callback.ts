import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
import { requireConfiguredSignIn } from "#frontend/context.server";
import { completeSignIn } from "#auth/handlers";
import { webAction } from "#frontend/web";
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: ({ request, context }) =>
        webAction(() => {
          requireConfiguredSignIn();
          return completeSignIn(request, context.deps.store);
        }),
    },
  },
});
