import { createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import type { AppRequestContext } from "../context.server";
import { applyContentSecurityPolicy, createNonce } from "#lib/content-security-policy";

export const requestContext = createMiddleware().server<AppRequestContext>(({ context, next }) =>
  // Carry the host's request context through Start's middleware and server-function type inference.
  next({ context: context }),
);

// Per-request nonce: the router stamps it on SSR <script> tags, the header allows exactly those.
export const contentSecurityPolicy = createMiddleware().server(async ({ next }) => {
  const nonce = createNonce();
  const result = await next({ context: { nonce } });
  applyContentSecurityPolicy(result.response, nonce);
  return result;
});

export const csrfProtection = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
});
