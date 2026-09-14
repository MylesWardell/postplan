import { notFoundResponse } from "../../response.server.js";
import { createFileRoute } from "@tanstack/react-router";
import { requireConfiguredSignIn } from "../../context.server.js";
import { completeSignIn } from "../../../auth/handlers.js";
import { webAction } from "../../../http/web.js";
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: ({ request, context }) =>
        webAction(() => {
          requireConfiguredSignIn();
          return completeSignIn(request, context.deps.db);
        }),
    },
  },
});
