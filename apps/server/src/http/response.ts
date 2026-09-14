import { config } from "../config.js";
import { getDraftIdFromHost } from "./public-url.js";
import { toORPCError, COMMON_ERROR_STATUS_MAP } from "@orpc/server";
import { notFoundResponse } from "../frontend/response.server.js";

export function hostDraftId(request: Request): string | null {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: new URL(request.url).hostname,
  });
}
export async function respond(action: () => Promise<Response> | Response): Promise<Response> {
  let response: Response;
  try {
    response = await action();
  } catch (error) {
    const failure = toORPCError(error);
    const status =
      COMMON_ERROR_STATUS_MAP[failure.code as keyof typeof COMMON_ERROR_STATUS_MAP] ?? 500;
    if (status >= 500) console.error(error);
    response = Response.json(failure.toJSON(), { status });
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
export function onlyApplication(
  request: Request,
  action: () => Promise<Response> | Response,
): Promise<Response> {
  return respond(() => (hostDraftId(request) ? notFoundResponse() : action()));
}
