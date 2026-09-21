import { WorkerEntrypoint } from "cloudflare:workers";
import policy from "../dist/policy.wasm";
import { createValidator } from "./validator";
import type { HtmlValidationOptions } from "@postplan/store/html-policy";

const validate = createValidator(policy);

/** Private service binding only. No public upload or storage endpoint. */
export default class HtmlValidator extends WorkerEntrypoint {
  validate(html: string, options: HtmlValidationOptions = {}) {
    return validate(html, options);
  }

  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
