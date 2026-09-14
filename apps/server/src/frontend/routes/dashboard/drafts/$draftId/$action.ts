import { postOnly } from "#frontend/methods";
import { authenticated } from "#frontend/auth";
import { createFileRoute } from "@tanstack/react-router";
import { ORPCError } from "@orpc/server";
import { parseFormData } from "@orpc/openapi/helpers";
import { redirect } from "#lib/redirect";
import { notFoundResponse } from "#frontend/response.server";

import { authenticatedContext } from "#frontend/context.server";
import { webAction } from "#frontend/web";

export const Route = createFileRoute("/dashboard/drafts/$draftId/$action")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: {
      ANY: () => notFoundResponse(),
      POST: ({ request, context, params: { draftId, action } }) =>
        webAction(async () => {
          const { caller } = await authenticatedContext(request, context);
          const form = parseFormData(await request.formData());
          switch (action) {
            case "update":
              await caller.drafts.update({
                draftId,
                title: form.title ?? "",
                description: form.description || null,
              });
              break;
            case "disable":
              await caller.drafts.disable({ draftId });
              break;
            case "enable":
              await caller.drafts.enable({ draftId });
              break;
            case "delete":
              if (form.confirmation !== "DELETE")
                throw new ORPCError("BAD_REQUEST", { message: "Type DELETE to confirm deletion." });
              await caller.drafts.delete({ draftId });
              return redirect("/dashboard");
            default:
              throw notFoundResponse();
          }
          return redirect(`/dashboard/drafts/${draftId}?saved=1`);
        }),
    },
  },
});
