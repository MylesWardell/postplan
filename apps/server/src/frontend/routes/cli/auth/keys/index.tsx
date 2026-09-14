import { postOnly } from "../../../../methods.js";
import { notFoundResponse } from "../../../../response.server.js";
import { authenticated } from "../../../../auth.js";
import { createFileRoute } from "@tanstack/react-router";
import { parseFormData } from "@orpc/openapi/helpers";
import { KeysPage } from "../index.js";
import { authenticatedContext } from "../../../../context.server.js";
import { webAction } from "../../../../web.js";
import { page } from "../../../../response.server.js";

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
