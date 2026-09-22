import { config } from "#config";
import { notFoundResponse } from "#frontend/response.server";
import { getDraftIdFromHost } from "@postplan/store/public-url";

import { respond } from "./respond";

export function hostDraftId(request: Request): string | null {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: new URL(request.url).hostname,
  });
}

// Application routes (API, health) never answer on draft subdomains.
export function onlyApplication(
  request: Request,
  action: () => Promise<Response> | Response,
): Promise<Response> {
  return respond(() => (hostDraftId(request) ? notFoundResponse() : action()));
}
