import { ORPCError } from "@orpc/server";
import { r2Storage } from "./r2";

// Lifetime reservations are never refunded, including failed/uncertain writes.
// This bounds retained objects and operations without relying on hourly analytics.
export function applicationStorage(db: D1Database, bucket: R2Bucket) {
  const storage = r2Storage(bucket);
  async function reserve(kind: "read" | "write", bytes = 0) {
    const result = db.prepare(
      kind === "write"
        ? `UPDATE application_budget SET writes=writes+1, bytes=bytes+? WHERE id=1
         AND writes<2000 AND bytes+?<=1073741824
         AND NOT EXISTS (SELECT 1 FROM usage_guard WHERE killed=1) RETURNING id`
        : `UPDATE application_budget SET reads=reads+1 WHERE id=1 AND reads<250000
         AND NOT EXISTS (SELECT 1 FROM usage_guard WHERE killed=1) RETURNING id`,
    );
    const admitted = await (kind === "write" ? result.bind(bytes, bytes) : result).first();
    if (!admitted) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Storage budget exhausted or application stopped.",
      });
    }
  }
  return {
    async putHtml(key: string, html: string) {
      const bytes = new TextEncoder().encode(html).length;
      if (bytes > 512 * 1024) {
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }
      await reserve("write", bytes);
      await storage.putHtml(key, html);
    },
    async getHtml(key: string) {
      await reserve("read");
      return storage.getHtml(key);
    },
  };
}
