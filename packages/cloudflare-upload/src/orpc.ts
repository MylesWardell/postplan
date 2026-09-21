import { Hono } from "hono";
import { implement, ORPCError } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { uploadInput, uploadOutput, uploadRejected } from "@postplan/api/schemas";
import type { Bindings } from "./bindings";
import { upload } from "./upload";
import { boundedRequest, UploadFailure, errorResponse, notFound } from "./http";
// Only the upload contract is constructed; importing the application's complete
// router would confound the stripped-down adapter comparison.
const uploadContract = oc
  .meta(openapi({ method: "POST", path: "/uploads", outputStructure: "detailed" }))
  .errors({ UNPROCESSABLE_CONTENT: { data: uploadRejected } })
  .input(uploadInput)
  .output(uploadOutput);
const procedure = implement(uploadContract)
  .$context<{ request: Request; env: Bindings }>()
  .handler(async ({ input, context }) => {
    try {
      return await upload(context.request, context.env, input);
    } catch (error) {
      if (error instanceof UploadFailure) {
        const codes: Record<number, string> = {
          400: "BAD_REQUEST",
          401: "UNAUTHORIZED",
          404: "NOT_FOUND",
          413: "PAYLOAD_TOO_LARGE",
          422: "UNPROCESSABLE_CONTENT",
          429: "TOO_MANY_REQUESTS",
          503: "SERVICE_UNAVAILABLE",
        };
        throw new ORPCError(codes[error.status] ?? "INTERNAL_SERVER_ERROR", {
          message: error.message,
          data: error.data,
        });
      }
      throw error;
    }
  });
const handler = new OpenAPIHandler({ upload: procedure });
const app = new Hono<{ Bindings: Bindings }>();
app.post("/api/uploads", async (c) => {
  const request = await boundedRequest(c.req.raw);
  const { matched, response } = await handler.handle(request, {
    prefix: "/api",
    context: { request, env: c.env },
  });
  return matched ? c.newResponse(response.body, response) : notFound();
});
app.notFound(notFound);
app.onError(errorResponse);
export default app;
