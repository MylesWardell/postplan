import { env } from "cloudflare:workers";
import { experimental_CloudflareTracer as CloudflareTracer } from "@orpc/cloudflare";

// Opt-in: oRPC wraps every middleware, validation and handler step in a span, which
// more than doubled request CPU in local benchmarks. Workers still traces bindings.
if (String(env.POSTPLAN_ORPC_TRACING) === "true") {
  new CloudflareTracer().enable();
}
