import { boundedBody } from "../../cloudflare/src/body";
import { ZodError } from "zod";
export class UploadFailure extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}
export async function boundedRequest(request: Request): Promise<Request> {
  const bytes = await boundedBody(request, 2 * 1024 * 1024);
  if (!bytes) {
    throw new UploadFailure(413, "Request body too large");
  }
  // The bounded reader consumed the original body. Each adapter receives a fresh,
  // unread Request; no Hono parser cache/proxy or second JSON serialization needed.
  return new Request(request, { method: "POST", body: bytes });
}
export function errorResponse(error: unknown): Response {
  const status =
    error instanceof UploadFailure ? error.status : error instanceof ZodError ? 400 : 500;
  if (status === 500) {
    console.error(JSON.stringify({ event: "upload_failed" }));
  }
  return Response.json(
    {
      ok: false,
      message:
        error instanceof UploadFailure
          ? error.message
          : status === 400
            ? "Invalid upload input"
            : "Upload failed",
      ...(error instanceof UploadFailure && error.data !== undefined ? { data: error.data } : {}),
    },
    { status },
  );
}
export const notFound = () => Response.json({ ok: false, message: "Not found" }, { status: 404 });
