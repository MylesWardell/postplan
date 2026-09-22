import { ORPCError } from "@orpc/server";

import type { ApiKeyAuth } from "./models";

// Historical public ownership is reserved permanently; it cannot authorize new writes.
export function requireUploadAuth(auth: ApiKeyAuth | null): ApiKeyAuth {
  if (!auth || auth.id === "key_public_upload" || auth.accountId === "acct_public_upload") {
    throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
  }
  return auth;
}
