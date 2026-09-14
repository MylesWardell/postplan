import { config } from "../config.js";
import { getDraftIdFromHost, getHomeUrl } from "./public-url.js";
import { errorResponse } from "./errors.js";
import { notFoundResponse } from "../frontend/pages.js";

export function hostDraftId(request: Request): string | null {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: new URL(request.url).hostname,
  });
}
export function applicationOrigin(request: Request): string {
  return getHomeUrl({
    publicBaseUrl: config.publicBaseUrl,
    requestBaseUrl: new URL(request.url).origin,
  });
}
export async function respond(action: () => Promise<Response> | Response): Promise<Response> {
  let response: Response;
  try {
    response = await action();
  } catch (error) {
    response = errorResponse(error);
  }
  if (response.status === 429) response.headers.set("Retry-After", "60");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
export function onlyApplication(
  request: Request,
  action: () => Promise<Response> | Response,
): Promise<Response> {
  return respond(() => (hostDraftId(request) ? notFoundResponse() : action()));
}
