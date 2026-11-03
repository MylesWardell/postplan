import { SpanKind, SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import type { TextMapGetter } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { ORPCInstrumentation } from "@orpc/opentelemetry";

// Enable export only when a collector is configured; never assume a local Jaeger instance.
const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
// Lambda freezes the sandbox after each response, so buffered spans must be flushed per request.
const lambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const processor = endpoint
  ? new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: endpoint }) })
  : undefined;
const sdk = processor
  ? new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": process.env.OTEL_SERVICE_NAME || "postplan",
        ...(process.env.DD_ENV ? { "deployment.environment.name": process.env.DD_ENV } : {}),
        ...(process.env.DD_VERSION ? { "service.version": process.env.DD_VERSION } : {}),
      }),
      spanProcessors: [processor],
      instrumentations: [getNodeAutoInstrumentations(), new ORPCInstrumentation()],
    })
  : undefined;
sdk?.start();

const tracer = trace.getTracer("postplan");
const headerGetter: TextMapGetter<Headers> = {
  get: (headers, key) => headers.get(key) ?? undefined,
  keys: (headers) => [...headers.keys()],
};

// Path segments that are followed by a caller-chosen identifier, except fixed routes.
const identifierParents = new Set(["d", "drafts", "keys", "v"]);
const fixedSegments = new Set(["totals"]);

/** Collapses draft IDs, key IDs and version numbers so span names stay low-cardinality. */
export function routeTemplate(pathname: string): string {
  const segments = pathname.split("/");
  return (
    segments
      .map((segment, index) =>
        segment &&
        !fixedSegments.has(segment) &&
        (identifierParents.has(segments[index - 1] ?? "") ||
          /^\d+$/.test(segment) ||
          /^[0-9a-f-]{32,36}$/i.test(segment))
          ? ":id"
          : segment,
      )
      .join("/") || "/"
  );
}

/** Wraps one HTTP request in a server span; a no-op tracer is used when export is disabled. */
export async function traceRequest(
  request: Request,
  handle: () => Response | Promise<Response>,
): Promise<Response> {
  if (!sdk) {
    return handle();
  }
  const url = new URL(request.url);
  const route = routeTemplate(url.pathname);
  try {
    return await tracer.startActiveSpan(
      `${request.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "http.route": route,
          "url.path": url.pathname,
          "server.address": url.hostname,
        },
      },
      // Bun.serve is not auto-instrumented, so continue any caller's W3C trace here.
      propagation.extract(context.active(), request.headers, headerGetter),
      async (span) => {
        try {
          const response = await handle();
          span.setAttribute("http.response.status_code", response.status);
          if (response.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          return response;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  } finally {
    if (lambda) {
      // Export to the local Datadog extension before Lambda freezes the sandbox.
      await processor?.forceFlush().catch(() => undefined);
    }
  }
}

export async function shutdownInstrumentation(): Promise<void> {
  await sdk?.shutdown();
}
