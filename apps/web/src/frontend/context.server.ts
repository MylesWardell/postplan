import { ORPCError } from "@orpc/server";
import { assertApplicationOrigin, readSession } from "#auth/session";
import { config } from "#config";
import { createCaller } from "#client";
import type { ContextFactory, ServerDependencies } from "#context";
import type { createApiHandler } from "#api";
import { messageResponse } from "./response.server";

export interface AppRequestContext {
  deps: ServerDependencies;
  createContext: ContextFactory;
  api: ReturnType<typeof createApiHandler>;
  peerIp: string | null;
}
export function requireConfiguredSignIn() {
  if (!config.sessionSecret || !config.publicBaseUrl) {
    throw messageResponse(
      "Sign-in unavailable",
      "Web sign-in has not been configured for this deployment.",
      503,
    ) as unknown as Error;
  }
}
export function authenticatedContext(request: Request, context: AppRequestContext) {
  requireConfiguredSignIn();
  const session = readSession(request);
  if (!session || request.headers.has("authorization")) {
    throw new ORPCError("UNAUTHORIZED");
  }
  assertApplicationOrigin(request);
  return { session, caller: createCaller(context.createContext(request, context.peerIp, true)) };
}
