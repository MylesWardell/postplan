import type { Request } from "express";
export * from "@postplan/core/public-url";
export function getRequestBaseUrl(req: Request): string {
  return `${req.protocol || "http"}://${req.get("host")}`;
}
