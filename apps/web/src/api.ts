import { RateLimitHandlerPlugin } from "@orpc/ratelimit";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { EvlogHandlerPlugin } from "@orpc/evlog";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "@postplan/api";
import { router } from "#routers/index";
import {
  RequestLimitHandlerPlugin,
  RequestCompressionHandlerPlugin,
  ResponseCompressionHandlerPlugin,
  ResponseHeadersHandlerPlugin,
  CORSHandlerPlugin,
} from "@orpc/server/plugins";
import type { ContextFactory } from "./context";
import { onlyApplication } from "#lib/host-guard";
import { notFoundResponse } from "#frontend/response.server";

export function createApiHandler(
  context: ContextFactory,
  options: { compressResponse: boolean; enableEvlog: boolean },
) {
  const zodConverter = new ZodToJsonSchemaConverter();
  const openapiGenerator = new OpenAPIGenerator({
    converters: [zodConverter],
  });
  const openapiHandler = new OpenAPIHandler(router, {
    plugins: [
      new RequestCompressionHandlerPlugin(),
      new RequestLimitHandlerPlugin({ maxBodySize: 2 * 1024 * 1024 }),
      new ResponseHeadersHandlerPlugin(),
      new RateLimitHandlerPlugin(),
      ...(options.compressResponse ? [new ResponseCompressionHandlerPlugin()] : []),
      new CORSHandlerPlugin({
        allowHeaders: [
          "Content-Disposition",
          "Standard-Server",
          "Content-Type",
          "Content-Encoding",
          "Authorization",
        ],
        exposeHeaders: [
          "Content-Disposition",
          "Standard-Server",
          "Retry-After",
          "X-Request-Id",
          "RateLimit-Limit",
          "RateLimit-Remaining",
          "RateLimit-Reset",
        ],
      }),
      ...(options.enableEvlog ? [new EvlogHandlerPlugin({ logAbort: true })] : []),
      new SmartCoercionHandlerPlugin({ converters: [zodConverter] }),
      new OpenAPIReferenceHandlerPlugin({
        spec: () =>
          openapiGenerator.generate(contract, {
            base: {
              info: { title: "Postplan API", version: "1.0.0" },
              servers: [{ url: "/api" }],
              components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
            },
          }),
        providerConfig: { authentication: { securitySchemes: { bearerAuth: {} } } },
      }),
    ],
  });
  return function handleOpenAPIRequest(request: Request, peerIp: string | null = null) {
    return onlyApplication(request, async () => {
      const { response } = await openapiHandler.handle(request, {
        prefix: "/api",
        context: context(request, peerIp, false),
      });
      return response ?? notFoundResponse();
    });
  };
}
