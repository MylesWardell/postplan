export function assertSqliteDatabase(value: string | undefined) {
  if (value !== undefined && value !== "sqlite") {
    throw new Error("POSTPLAN_DATABASE must be sqlite for Cloudflare (D1).");
  }
}
