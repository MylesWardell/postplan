export * from "@postplan/core/public-url";
export function getRequestBaseUrl(req: Request): string {
  return new URL(req.url).origin;
}
