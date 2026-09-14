import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.js";

// Set by the contentSecurityPolicy request middleware in start.ts.
const getNonce = createIsomorphicFn()
  .server(() => (getGlobalStartContext() as unknown as { nonce: string }).nonce)
  .client(() => undefined);

export function getRouter() {
  return createRouter({
    ssr: { nonce: getNonce() },
    routeTree,
    scrollRestoration: true,
    trailingSlash: "preserve",
    defaultPreload: false,
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
