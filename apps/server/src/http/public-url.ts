export * from "../lib/public-url.js";
export function getRequestBaseUrl(req: Request): string {
  return new URL(req.url).origin;
}
