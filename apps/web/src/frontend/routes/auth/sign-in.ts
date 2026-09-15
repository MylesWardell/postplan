import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
import { requireConfiguredSignIn } from "#frontend/context.server";
import { signIn } from "#auth/handlers";
import { webAction } from "#frontend/web";
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
