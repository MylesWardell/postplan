import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import type { AppRequestContext } from "./context.server.js";

export const requestContext = createMiddleware().server<AppRequestContext>(({ context, next }) =>
  // Carry the host's request context through Start's middleware and server-function type inference.
  next({ context: context as unknown as AppRequestContext }),
);

// Per-request nonce: the router stamps it on SSR <script> tags, the header allows exactly those.
export const contentSecurityPolicy = createMiddleware().server(async ({ next }) => {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const result = await next({ context: { nonce } });
  const { headers } = result.response;
  if (headers.get("content-type")?.includes("text/html") && !headers.has("Content-Security-Policy")) {
    const dev = process.env.NODE_ENV !== "production";
    headers.set(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'${dev ? " 'unsafe-inline'" : ""}; img-src https: data:; connect-src 'self'${dev ? " ws: wss:" : ""}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestContext,
    contentSecurityPolicy,
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" }),
  ],
}));
