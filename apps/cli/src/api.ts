import { createORPCClient } from "@orpc/client";
import { RequestCompressionLinkPlugin } from "@orpc/client/plugins";
import { RequestValidationLinkPlugin } from "@orpc/contract/plugins";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { contract, type ApiClient } from "@postplan/api";
import { VERSION } from "./version";

export interface ApiConnection {
  apiUrl: string;
  apiKey?: string | undefined;
}

/**
 * Typed client for the Postplan HTTP API, derived from the shared oRPC contract.
 * Inputs are validated against the contract before any request is sent.
 */
export function createApiClient({ apiUrl, apiKey }: ApiConnection): ApiClient {
  const link = new OpenAPILink(contract, {
    origin: apiUrl,
    url: "/api",
    headers: {
      "User-Agent": `postplan/${VERSION}`,
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    plugins: [new RequestValidationLinkPlugin(contract), new RequestCompressionLinkPlugin()],
  });

  return createORPCClient(link);
}
