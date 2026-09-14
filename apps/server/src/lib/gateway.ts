import { isIP } from "node:net";
import { config } from "#config";
import { getHomeUrl } from "./public-url";

export function gatewayRequest(request: Request): { request: Request; peerIp: string | null } {
  if (!config.apiGateway) {
    return { request, peerIp: null };
  }
  // The Lambda Web Adapter overwrites this header from the invocation context.
  const context = JSON.parse(request.headers.get("x-amzn-request-context") ?? "{}") as {
    domainName?: string;
    requestId?: string;
    http?: { sourceIp?: string };
  };
  const root = new URL(getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: "" }))
    .hostname;
  const host = context.domainName;
  const wildcard = config.publicBaseUrl?.startsWith("https://*.");
  const draft = host?.endsWith(`.${root}`) ? host.slice(0, -(root.length + 1)) : "";
  if (
    !host ||
    !(host === root || (wildcard && /^[a-z0-9]{12}$/.test(draft))) ||
    !context.http?.sourceIp ||
    !isIP(context.http.sourceIp)
  ) {
    throw new Error("Invalid API Gateway request context.");
  }
  const url = new URL(request.url);
  url.protocol = "https:";
  url.host = host;
  url.port = "";
  const headers = new Headers(request.headers);
  headers.delete("x-real-ip");
  headers.delete("x-forwarded-for");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  headers.set("host", host);
  if (context.requestId) {
    headers.set(config.requestIdHeader, context.requestId);
  }
  return {
    request: new Request(url, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: request.redirect,
      signal: request.signal,
    }),
    peerIp: context.http.sourceIp,
  };
}
