import { parseRetentionDays } from "@postplan/store/retention";

// Keep tombstones and lifetime reservations. Never make old IDs reusable or
// replenish a spending budget as a side effect of deleting content.
export async function cleanup(env: Cloudflare.Env, now = Date.now()) {
  const db = env.POSTPLAN_DB;
  if ((await db.prepare("SELECT killed FROM usage_guard WHERE id=1").first("killed")) === 1) {
    return;
  }
  const days = parseRetentionDays(process.env.PLAN_RETENTION_DAYS);
  if (days > 0) {
    await db
      .prepare(`UPDATE drafts SET deleted_at=? WHERE deleted_at IS NULL AND id IN (
      SELECT d.id FROM drafts d JOIN draft_versions v ON v.id=d.current_version_id
      WHERE d.deleted_at IS NULL AND v.created_at<=? LIMIT 25
    )`)
      .bind(now, now - days * 86400000)
      .run();
  }
  const versions = await db
    .prepare(`SELECT v.id, v.object_key FROM draft_versions v
    JOIN drafts d ON d.id=v.draft_id WHERE d.deleted_at IS NOT NULL AND d.deleted_at<=?
    ORDER BY d.deleted_at LIMIT 25`)
    .bind(now - 60000)
    .all<{ id: string; object_key: string }>();
  for (const version of versions.results) {
    await env.HTML_BUCKET.delete(version.object_key);
    await db.batch([
      db
        .prepare(
          "UPDATE drafts SET current_version_id=NULL WHERE current_version_id=? AND deleted_at IS NOT NULL",
        )
        .bind(version.id),
      db.prepare("DELETE FROM upload_events WHERE draft_version_id=?").bind(version.id),
      db
        .prepare(
          "DELETE FROM draft_versions WHERE id=? AND draft_id IN (SELECT id FROM drafts WHERE deleted_at IS NOT NULL)",
        )
        .bind(version.id),
    ]);
  }
}
