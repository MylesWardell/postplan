import { postOnly } from "#frontend/middleware/methods";
import { notFoundResponse } from "#frontend/response.server";
import { authenticated } from "#frontend/middleware/authenticated";
import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "#lib/redirect";
import { webAction } from "#frontend/web";
import { authenticatedContext } from "#frontend/context.server";
export const Route = createFileRoute("/cli/auth/keys/$keyId/revoke")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: {
      ANY: () => notFoundResponse(),
      POST: ({ request, context, params }) =>
        webAction(async () => {
          const { caller } = await authenticatedContext(request, context);
          await caller.apiKeys.revoke({ apiKeyId: params.keyId });
          return redirect("/cli/auth");
        }),
    },
  },
});
