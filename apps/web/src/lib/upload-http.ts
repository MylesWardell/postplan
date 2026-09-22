import type { RateLimiter } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";

import type { ContextFactory } from "#context";
import { uploadInput, uploadOutput } from "@postplan/api/schemas";
import { requireUploadAuth } from "@postplan/store";

import { resolveApiContext } from "./api-context";
import { clientIp } from "./client-ip";
import { respond } from "./respond";

const MAX_BODY = 2 * 1024 * 1024;
const MAX_ENCODINGS = 2;
async function readBody(
  stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) {
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      throw new ORPCError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createUploadHandler(createContext: ContextFactory) {
  return async (request: Request, peerIp: string | null): Promise<Response> => {
    const headers = new Headers();
    const response = await respond(async () => {
      const base = createContext(request, peerIp, false);
      let remaining = Infinity;
      const admit = async (limiter: RateLimiter, key: string) => {
        const result = await limiter.limit(key);
        if (!result.success || (result.remaining ?? Infinity) <= remaining) {
          remaining = result.remaining ?? Infinity;
          for (const name of ["limit", "remaining", "reset"] as const) {
            if (result[name] !== undefined) {
              headers.set("RateLimit-" + name, String(result[name]));
            }
          }
        }
        if (!result.success) {
          if (result.reset !== undefined) {
            headers.set(
              "Retry-After",
              String(Math.max(0, Math.ceil((result.reset - Date.now()) / 1000))),
            );
          }
          throw new ORPCError("TOO_MANY_REQUESTS", {
            data: { limit: result.limit, remaining: result.remaining, reset: result.reset },
          });
        }
      };
      // Meter every attempt before authentication lookup or reading the body.
      await admit(base.rateLimiters["upload-ip"], clientIp(request, peerIp) || "anonymous");
      const ctx = await resolveApiContext(base, headers);
      const auth = requireUploadAuth(ctx.apiKey);
      await admit(ctx.rateLimiters["upload-key"], auth.id);

      const encodings =
        request.headers
          .get("content-encoding")
          ?.split(",", MAX_ENCODINGS + 1)
          .map((part) => part.trim().toLowerCase()) ?? [];
      if (
        encodings.length > MAX_ENCODINGS ||
        encodings.some(
          (encoding) => !["identity", "gzip", "deflate", "deflate-raw"].includes(encoding),
        )
      ) {
        throw new ORPCError("UNSUPPORTED_MEDIA_TYPE");
      }
      let bytes = await readBody(request.body);
      for (const encoding of encodings.toReversed()) {
        if (encoding === "identity") {
          continue;
        }
        try {
          bytes = await readBody(
            new Blob([bytes])
              .stream()
              .pipeThrough(new DecompressionStream(encoding as CompressionFormat)),
          );
        } catch (error) {
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("BAD_REQUEST", { message: "Invalid compressed request." });
        }
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid JSON." });
      }
      const parsed = uploadInput.safeParse(body);
      if (!parsed.success) {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid upload input." });
      }
      const result = await ctx.store.drafts.upload({ context: ctx, input: parsed.data });
      if (!result.ok) {
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message: "HTML validation failed.",
          data: result,
        });
      }
      const output = uploadOutput.parse({
        status: result.versionNumber === 1 ? 201 : 200,
        body: result,
      });
      return Response.json(output.body, { status: output.status });
    });
    headers.forEach((value, name) => response.headers.set(name, value));
    return response;
  };
}
