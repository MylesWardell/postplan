import { COMMON_ERROR_STATUS_MAP, toORPCError } from "@orpc/server";
import type { ORPCError } from "@orpc/server";

// Map any thrown value to an oRPC error and HTTP status, logging server faults.
export function toHttpError(error: unknown): {
  failure: ORPCError<string, unknown>;
  status: number;
} {
  const failure = toORPCError(error);
  const status =
    COMMON_ERROR_STATUS_MAP[failure.code as keyof typeof COMMON_ERROR_STATUS_MAP] ?? 500;
  if (status >= 500) console.error(error);
  return { failure, status };
}

// Top-level wrapper for Bun routes: renders uncaught errors (JSON by default)
// and applies the security headers every response carries.
export async function respond(
  action: () => Promise<Response> | Response,
  renderError: (failure: ORPCError<string, unknown>, status: number) => Response = (
    failure,
    status,
  ) => Response.json(failure.toJSON(), { status }),
): Promise<Response> {
  let response: Response;
  try {
    response = await action();
  } catch (error) {
    const { failure, status } = toHttpError(error);
    response = renderError(failure, status);
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
