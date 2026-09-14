# Database

`src/schema.ts` is the source of truth for PostgreSQL tables and inferred row types. Application queries use Drizzle; the `pg` driver is confined to connection setup and the migration lock.

From the repository root:

```sh
pnpm db:generate
pnpm db:migrate
```

Generation writes reviewable SQL and schema snapshots without connecting to a database. Migration loads the root `.env` if present and applies reviewed SQL to `DATABASE_URL`, recording it in Drizzle's migration journal. It verifies the configured PostgreSQL CA and serializes concurrent migration processes with an advisory lock. Never run migration commands against an environment unintentionally.

The initial migration is an idempotent compatibility baseline adapted from the previous startup DDL. It creates an empty installation or preserves the existing six tables and backfills previously introduced columns. Review unexpected schema drift separately; the baseline does not repair arbitrary manual changes. Keep its generated snapshot and SQL immutable once applied.

Server startup seeds the public-upload identity and optional bootstrap key; it no longer changes the schema. Apply migrations once before starting a new release. Use a DDL-capable migration role and a DML-only application role in production. Future changes must preserve compatibility with the previous application version during rolling updates.

Tests use PGlite, an embedded PostgreSQL engine, for schema migration, identity and API-key behavior. They do not replace staging checks against networked RDS, concurrent connections, certificate rotation, or backups.
