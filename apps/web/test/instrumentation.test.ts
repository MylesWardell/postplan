import assert from "node:assert/strict";

import { trace } from "@opentelemetry/api";
import { afterAll, test } from "vitest";

// Enable the SDK before import; the unused port only receives the final shutdown export.
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:9/v1/traces";
const { routeTemplate, shutdownInstrumentation, traceRequest } =
  await import("../src/instrumentation");
afterAll(() => shutdownInstrumentation().catch(() => undefined));

test("span routes collapse caller-chosen identifiers", () => {
  assert.equal(routeTemplate("/"), "/");
  assert.equal(routeTemplate("/healthz"), "/healthz");
  assert.equal(routeTemplate("/api/uploads"), "/api/uploads");
  assert.equal(routeTemplate("/api/drafts/totals"), "/api/drafts/totals");
  assert.equal(routeTemplate("/api/drafts/my-plan/disable"), "/api/drafts/:id/disable");
  assert.equal(routeTemplate("/d/kms-migration-plan/raw"), "/d/:id/raw");
  assert.equal(routeTemplate("/d/abc/v/12/raw"), "/d/:id/v/:id/raw");
  assert.equal(routeTemplate("/v/3/raw"), "/v/:id/raw");
  assert.equal(routeTemplate("/dashboard/drafts/my-plan/disable"), "/dashboard/drafts/:id/disable");
  assert.equal(
    routeTemplate("/cli/auth/keys/0b6c1f4e-8f0e-4d7e-9a43-7e2f3b1c9d10/revoke"),
    "/cli/auth/keys/:id/revoke",
  );
});

test("request spans continue an incoming W3C trace", async () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  let active: string | undefined;
  const response = await traceRequest(
    new Request("https://plans.example.com/healthz", {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    }),
    () => {
      active = trace.getActiveSpan()?.spanContext().traceId;
      return new Response("ok");
    },
  );
  assert.equal(response.status, 200);
  assert.equal(active, traceId);
});
