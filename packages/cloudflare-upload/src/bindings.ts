import type HtmlValidator from "../../html-validator/src/worker";
import type { RateLimit } from "../../cloudflare/src/rate-limit";
// Wrangler generates runtime bindings; refine cross-Worker RPC types only.
export type Bindings = Omit<Cloudflare.Env, "HTML_VALIDATOR" | "RATE_LIMITS"> & {
  HTML_VALIDATOR: Service<HtmlValidator>;
  RATE_LIMITS: DurableObjectNamespace<RateLimit>;
};
