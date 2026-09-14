import { readSession } from "../auth/session.js";
import { ORPCError } from "@orpc/server";
import { config } from "../config.js";
import { createCaller } from "../client.js";
import type { ContextFactory, ServerDependencies } from "../http/context.js";
import type { createApiHandler } from "../http/api.js";
import { messageResponse } from "./response.server.js";

export interface AppRequestContext {
  deps: ServerDependencies;
  resolveContext: ContextFactory;
  api: ReturnType<typeof createApiHandler>;
  peerIp: string | null;
}
declare module "@tanstack/react-router" {
  interface Register {
    server: { requestContext: AppRequestContext };
  }
}
export function requireConfiguredSignIn() {
  if (!config.sessionSecret || !config.publicBaseUrl)
    throw messageResponse(
      "Sign-in unavailable",
      "Web sign-in has not been configured for this deployment.",
      503,
    );
}
export async function authenticatedContext(request: Request, context: AppRequestContext) {
  requireConfiguredSignIn();
  const apiContext = await context.resolveContext(request, true, context.peerIp);
  const session = readSession(request);
  if (!apiContext.session || !session) throw new ORPCError("UNAUTHORIZED");
  return { session, caller: createCaller(apiContext) };
}
