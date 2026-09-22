import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ORPCInstrumentation } from "@orpc/opentelemetry";

// Enable export only when a collector is configured; never assume a local Jaeger instance.
const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const sdk = endpoint
  ? new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": process.env.OTEL_SERVICE_NAME || "postplan",
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
      instrumentations: [getNodeAutoInstrumentations(), new ORPCInstrumentation()],
    })
  : undefined;
sdk?.start();

export async function shutdownInstrumentation(): Promise<void> {
  await sdk?.shutdown();
}
