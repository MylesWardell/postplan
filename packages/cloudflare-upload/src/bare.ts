import type { Bindings } from "./bindings";
import { directUpload } from "./direct";
import { errorResponse, notFound } from "./http";
// Matched control: same input/output schemas, upload code and bindings, no router.
export default {
  async fetch(request: Request, env: Bindings) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/api/uploads") {
      return notFound();
    }
    try {
      return await directUpload(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
