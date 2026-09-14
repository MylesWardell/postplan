import { ORPCError } from "@orpc/server";

// Bound streamed bodies too; Content-Length alone is not an enforcement boundary.
export const maxBodyBytes = 2 * 1024 * 1024;
export async function boundedRequest(req: Request): Promise<Request> {
  if (!req.body) return req;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: Buffer.concat(chunks),
  });
}
export async function formBody(req: Request): Promise<URLSearchParams> {
  if (!req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    throw new ORPCError("UNSUPPORTED_MEDIA_TYPE");
  return new URLSearchParams(await req.text());
}
