import { postOnly } from "#frontend/middleware/methods";
import { notFoundResponse } from "#frontend/response.server";
import { createFileRoute } from "@tanstack/react-router";
import { authenticated } from "#frontend/middleware/authenticated";
import { clearSessionCookie } from "#auth/session";
import { redirect } from "#lib/redirect";
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: { ANY: () => notFoundResponse(), POST: () => redirect("/", [clearSessionCookie()]) },
  },
});
