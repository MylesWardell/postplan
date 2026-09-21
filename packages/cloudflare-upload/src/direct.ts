import { uploadInput, uploadOutput } from "@postplan/api/schemas";
import type { Bindings } from "./bindings";
import { upload } from "./upload";
import { boundedRequest, UploadFailure } from "./http";
export async function directUpload(incoming: Request, env: Bindings) {
  const request = await boundedRequest(incoming);
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new UploadFailure(400, "Invalid JSON");
  }
  const input = uploadInput.parse(value);
  const result = uploadOutput.parse(await upload(request, env, input));
  return Response.json(result.body, { status: result.status });
}
