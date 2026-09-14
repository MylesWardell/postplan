# Database

Drizzle uses Bun's built-in SQLite driver, following the [Bun guide](https://bun.com/guides/ecosystem/drizzle). `src/db/schema.ts` defines tables; routers own queries. `DATABASE_PATH` defaults to `data/postplan.sqlite`, relative to the process working directory. Use an absolute path in production.

From the repository root:

```sh
bun run db:generate
bun run db:migrate
```

Generation writes SQL and snapshots without opening a database. Migration loads the root `.env` and applies pending SQL to SQLite. Run one migration process with the app stopped, then start the release. Startup seeds accounts and keys but does not change the schema. Keep applied migrations immutable.

Connections enable WAL, foreign keys and a five-second busy timeout. Transactions are synchronous: storage I/O finishes first, then an immediate transaction allocates the version and records all rows atomically. A failed transaction can leave an unreferenced storage object. Run a single server process with the database on persistent local disk.

This is a fresh SQLite baseline, not an in-place upgrade of PostgreSQL. Existing installations need a separate export/import: preserve IDs, key hashes and object keys; convert dates to epoch milliseconds, booleans to integers and JSON to text; verify row counts, relationships and content hashes before switching. No existing database has been converted or modified.

Back up with SQLite's online backup API or `VACUUM INTO` to a new file, then copy that completed snapshot off-host. Do not copy only the live main file while WAL writes are active. Verify `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on a restored copy. See [SQLite backups](https://sqlite.org/backup.html) and the [AWS plan](../../docs/aws-deployment-plan.md).

Tests use the production SQLite adapter for migrations, identities, concurrent versions, HTTP and SSR forms.
