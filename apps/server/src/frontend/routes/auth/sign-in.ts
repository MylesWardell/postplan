import { notFoundResponse } from "../../response.server.js";
import { createFileRoute } from "@tanstack/react-router";
import { requireConfiguredSignIn } from "../../context.server.js";
import { signIn } from "../../../auth/handlers.js";
import { webAction } from "../../../http/web.js";
export const Route = createFileRoute("/auth/sign-in")({
  server: {
    handlers: {
      ANY: () => notFoundResponse(),
      GET: ({ request }) =>
        webAction(() => {
          requireConfiguredSignIn();
          return signIn(request);
        }),
    },
  },
});
