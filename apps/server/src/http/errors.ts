import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { ORPCError } from "@orpc/server";
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function errorResponse(error: unknown): Response {
  const status = errorStatus(error);
  if (status >= 500) console.error(error);
  return Response.json(
    { ok: false, error: status >= 500 ? "Internal server error." : errorMessage(error) },
    {
      status,
      headers: status === 429 ? { "Retry-After": "60" } : {},
    },
  );
}

export function errorStatus(error: unknown): number {
  return error instanceof ORPCError
    ? ((COMMON_ERROR_STATUS_MAP as Record<string, number>)[error.code] ?? 500)
    : 500;
}
