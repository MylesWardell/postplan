import type { Request } from "express";

// Error carrying an HTTP status for the final Express error handler.
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Express 5 types every route param as `string | string[]` (the array form is
// only produced by `*splat` segments, which postplan does not use).
export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function statusCodeOf(error: unknown): number {
  if (typeof error === "object" && error !== null) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status > 0) return status;
  }
  return 500;
}
