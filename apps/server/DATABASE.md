# Database

## Store packages

`@postplan/store` defines provider-independent oRPC contracts in `account-store.ts` and `draft-store.ts`, reusing the public API's result schemas. `@postplan/store-drizzle` and `@postplan/store-dynamodb` each implement those contracts and return a `StoreConnection` containing a typed in-process client and a close function. Driver types never enter the application context.

The server selects the provider in `src/db/client.ts`. Routes, authentication, health checks, and rate limiting consume only `Store`. HTML validation, public URL helpers, and domain types live in the shared package; SQLite schema/migrations and DynamoDB cleanup remain with their respective adapters. No store procedures are exposed as HTTP routes.

To add a provider, create a `packages/store-<provider>` workspace, depend on `@postplan/store`, implement both store contracts and the lifecycle/rate-limit procedures with `implement(storeContract)`, and return `createRouterClient(router)` as `Store`. Register its factory at the composition boundary. Run the shared API, SSR, and `store.test.ts` suites against it. Provider-specific operational behavior remains explicit: SQLite seeds on initialization and uses memory limits; DynamoDB requires explicit bootstrap, shares limits in DynamoDB, and implements retention cleanup.

## DynamoDB

Set all four table names to select DynamoDB: `POSTPLAN_IDENTITY_TABLE`, `POSTPLAN_PLANS_TABLE`, `POSTPLAN_RECORDS_TABLE`, and `POSTPLAN_RATE_LIMITS_TABLE`. Partial configuration fails startup; Lambda never falls back to SQLite. Terraform creates the tables and indexes. AWS credentials come from the execution role. `POSTPLAN_DYNAMODB_ENDPOINT` is for local development with dummy credentials.

The DynamoDB stores use conditional transactions for account identities, API keys, ownership, concurrent version allocation, and upload publication. Consistent base-table reads enforce revocation and expiry; list indexes are eventually consistent. Dates retain the existing API format. Stored date fields use epoch milliseconds, while `lastUploadedAt`, upload leases, and `ttlAt` use epoch seconds. HTML remains in S3.

After building, run `bun apps/server/dist/src/db/bootstrap.js` with the table configuration and optional bootstrap secret to seed accounts. `POSTPLAN_SESSION_SECRET_PARAMETER_ARN` and `POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN` load SecureString values from SSM before startup. Normal Lambda cold starts do not seed or rotate keys.

`PLAN_RETENTION_DAYS` defaults to **90**; a positive whole number changes the window and **0 disables automatic expiry**. Retention applies to the entire plan, measured from its last successful upload. Reads and mutations reject expired plans immediately. Changing retention affects existing active plans; it cannot restore plans already claimed for deletion. SQLite does not implement this retention policy.

The daily cleanup Lambda claims expired plans conditionally, waits 24 hours for in-flight work, deletes their S3 objects and all child records, then assigns a seven-day native DynamoDB TTL to the tombstone. Failed deletion remains retryable. Upload intents fence publication and let cleanup remove abandoned uploads. Cleanup also runs with retention disabled to finish claimed deletions and remove abandoned uploads. Active plans, versions, accounts, and API keys never receive native TTL. Rate-limit counters have separate housekeeping TTLs; enforcement does not depend on timely TTL deletion.

Build container targets `lambda-app` and `lambda-cleanup` for Terraform. The default image retains SQLite support. See the [deployment instructions](../../infra/terraform/README.md). No automatic SQLite import is included: an existing installation needs a reviewed migration preserving IDs, key hashes, identities, timestamps, version relationships, and S3 object keys, with writes stopped during cutover.

CI runs the API, dashboard forms, and DynamoDB concurrency/retention tests against DynamoDB Local. To repeat locally, start DynamoDB Local, build the repo, set `POSTPLAN_TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8000`, and run `bun test --conditions=source ./test/api.test.ts ./test/ssr.test.ts ./test/dynamo.test.ts ./test/gateway.test.ts ./test/store.test.ts` from `apps/server`. The fixture only accepts loopback endpoints and creates/deletes isolated test tables. Without that variable, existing tests use SQLite and DynamoDB integration tests are skipped.

## SQLite

Drizzle uses Bun's built-in SQLite driver, following the [Bun guide](https://bun.com/guides/ecosystem/drizzle). `packages/store-drizzle/src/schema.ts` defines tables with camelCase properties, which Drizzle's `casing: "snake_case"` maps to snake_case SQL columns. Queries and migrations belong to that package. `DATABASE_PATH` defaults to `data/postplan.sqlite`, relative to the process working directory. Use an absolute path in production.

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
