import { isIP } from "node:net";
import { getHomeUrl } from "@postplan/store/public-url";

export function cloudflareGateway(
  request: Request,
  options: { publicBaseUrl: string; requestIdHeader: string; local?: boolean },
) {
  const url = new URL(request.url);
  const home = new URL(getHomeUrl({ publicBaseUrl: options.publicBaseUrl, requestBaseUrl: "" }));
  const draft = url.hostname.endsWith(`.${home.hostname}`)
    ? url.hostname.slice(0, -(home.hostname.length + 1))
    : "";
  const draftHost = options.publicBaseUrl.startsWith("https://*.") && /^[a-z0-9]{12}$/.test(draft);
  if (
    !(url.hostname === home.hostname || draftHost) ||
    (!options.local && (url.protocol !== "https:" || url.port !== ""))
  ) {
    throw new Error("Invalid Cloudflare gateway host.");
  }
  const peerIp = request.headers.get("cf-connecting-ip");
  if (peerIp !== null && !isIP(peerIp)) {
    throw new Error("Invalid Cloudflare client IP.");
  }
  const headers = new Headers(request.headers);
  for (const name of [
    "x-real-ip",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-amzn-request-context",
    "x-amzn-trace-id",
    "forwarded",
  ]) {
    headers.delete(name);
  }
  headers.set("host", url.host);
  headers.set(
    options.requestIdHeader,
    request.headers.get("cf-ray")?.slice(0, 255) || crypto.randomUUID(),
  );
  return { request: new Request(request, { headers }), peerIp, draftHost };
}
