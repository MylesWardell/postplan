// Lifetime budget, deliberately retained across retries and deployments.
export async function reserveProbe(db: D1Database) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS usage_guard (id INTEGER PRIMARY KEY CHECK(id=1), killed INTEGER NOT NULL CHECK(killed IN (0,1)))",
  );
  await db.exec(
    "CREATE TABLE IF NOT EXISTS experiment_budget (id INTEGER PRIMARY KEY CHECK(id=1), used INTEGER NOT NULL CHECK(used BETWEEN 0 AND 20))",
  );
  const results = await db.batch([
    db.prepare("INSERT OR IGNORE INTO experiment_budget (id, used) VALUES (1, 0)"),
    db.prepare(
      "UPDATE experiment_budget SET used=used+1 WHERE id=1 AND used<20 AND NOT EXISTS (SELECT 1 FROM usage_guard WHERE killed=1) RETURNING used",
    ),
  ]);
  return results[1]?.results.length === 1;
}
