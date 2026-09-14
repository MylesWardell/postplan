import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@postplan/api";

export function createDraftsClient(url = "/trpc") {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url,
        fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
      }),
    ],
  });
}
