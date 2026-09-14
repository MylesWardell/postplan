import { postOnly } from "../../methods.js";
import { notFoundResponse } from "../../response.server.js";
import { createFileRoute } from "@tanstack/react-router";
import { authenticated } from "../../auth.js";
import { clearSessionCookie } from "#auth/session";
import { redirect } from "#lib/redirect";
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: { ANY: () => notFoundResponse(), POST: () => redirect("/", [clearSessionCookie()]) },
  },
});
