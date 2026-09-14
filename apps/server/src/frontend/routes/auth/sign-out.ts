import { postOnly } from "../../methods.js";
import { notFoundResponse } from "../../response.server.js";
import { createFileRoute } from "@tanstack/react-router";
import { authenticated } from "../../auth.js";
import { clearSessionCookie } from "../../../auth/session.js";
import { redirect } from "../../../http/redirect.js";
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    middleware: [postOnly, authenticated],
    handlers: { ANY: () => notFoundResponse(), POST: () => redirect("/", [clearSessionCookie()]) },
  },
});
