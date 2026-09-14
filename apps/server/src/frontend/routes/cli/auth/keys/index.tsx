import { postOnly } from "#frontend/middleware/methods";
import { notFoundResponse } from "#frontend/response.server";
import { authenticated } from "#frontend/middleware/authenticated";
import { createFileRoute } from "@tanstack/react-router";
import { parseFormData } from "@orpc/openapi/helpers";
import { KeysPage } from "#frontend/routes/cli/auth/index";
import { authenticatedContext } from "#frontend/context.server";
import { webAction } from "#frontend/web";
import { page } from "#frontend/response.server";

export const Route = createFileRoute("/cli/auth/keys/")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: {
      ANY: () => notFoundResponse(),
      POST: ({ request, context }) =>
        webAction(async () => {
          const { session, caller } = await authenticatedContext(request, context);
          const form = parseFormData(await request.formData());
          const keyName = form.name || `CLI · ${new Date().toISOString().slice(0, 10)}`;
          const { token } = await caller.apiKeys.create({ name: keyName });
          return page(
            <KeysPage
              session={session}
              keys={await caller.apiKeys.list()}
              token={token}
              keyName={keyName}
            />,
          );
        }),
    },
  },
});
