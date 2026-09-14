import { postOnly } from "../../../../../methods.js";
import { notFoundResponse } from "../../../../../response.server.js";
import { authenticated } from "../../../../../auth.js";
import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "#lib/redirect";
import { webAction } from "../../../../../web.js";
import { authenticatedContext } from "../../../../../context.server.js";
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
