import type { createApplication } from "@postplan/web/application";
import { boundedBody } from "./body";
import { cloudflareGateway } from "./gateway";

type Application = ReturnType<typeof createApplication>;

function logFailure(request: Request, response: Response, peerIp: string | null = null) {
  if (response.status < 400) {
    return;
  }
  const record = JSON.stringify({
    event: "request_failure",
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    requestId: request.headers.get("x-request-id") ?? request.headers.get("cf-ray"),
    clientIp: peerIp,
  });
  if (response.status >= 500) {
    console.error(record);
  } else {
    console.warn(record);
  }
}

export async function handleCloudflareRequest(
  incoming: Request,
  env: Cloudflare.Env,
  application: Application,
): Promise<Response> {
  const finish = (request: Request, response: Response, peerIp: string | null = null) => {
    logFailure(request, response, peerIp);
    return response;
  };
  let gateway;
  try {
    gateway = cloudflareGateway(incoming, {
      publicBaseUrl: env.POSTPLAN_PUBLIC_BASE_URL,
      requestIdHeader: "x-request-id",
      local: env.POSTPLAN_LOCAL === "true",
    });
  } catch {
    return finish(incoming, new Response("Invalid gateway request", { status: 400 }));
  }
  const { request, peerIp, draftHost } = gateway;
  const enabled = String(env.POSTPLAN_APPLICATION_ENABLED) === "true";
  if (draftHost && !enabled) {
    return finish(request, new Response("Not found", { status: 404 }), peerIp);
  }
  const path = new URL(request.url).pathname;
  if (!draftHost && path.startsWith("/assets/")) {
    return finish(request, await env.ASSETS.fetch(request), peerIp);
  }
  if (!enabled && !["/", "/healthz", "/api/spec.json"].includes(path)) {
    return finish(
      request,
      new Response("Application data routes are not enabled.", { status: 503 }),
      peerIp,
    );
  }
  if (enabled) {
    try {
      const budget = await env.POSTPLAN_DB.prepare(
        "SELECT id, (SELECT killed FROM usage_guard WHERE id=1) AS killed FROM application_budget WHERE id=1",
      ).first<{ id: number; killed: number | null }>();
      if (budget?.killed === 1) {
        return finish(request, new Response("Application stopped", { status: 503 }), peerIp);
      }
      // Missing migrations fail closed; bootstrap is an explicit deployment step.
      if (!budget) {
        throw new Error("Missing budget");
      }
    } catch {
      return finish(
        request,
        new Response("Application storage is not initialized", { status: 503 }),
        peerIp,
      );
    }
  }
  let applicationRequest = request;
  if (request.body) {
    const body = await boundedBody(request, 2 * 1024 * 1024);
    if (!body) {
      return finish(request, new Response("Request body too large", { status: 413 }), peerIp);
    }
    applicationRequest = new Request(request, { method: request.method, body });
  }
  // The edge handles compression; workerd otherwise strips the plugin's encoding header.
  return finish(request, await application(applicationRequest, peerIp), peerIp);
}
