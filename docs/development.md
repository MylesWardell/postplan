# Development

## Requirements

- Bun 1.4.2 or later
- Node 26.8.2 or later

Bun manages the workspace and runs the server. Node runs the portable CLI and compatible tooling. Turborepo orders package builds, oxfmt formats the workspace, and oxlint checks source files.

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

`bun run check` runs formatting, lint, strict type checks, and tests. The test suite uses SQLite and local storage and OAuth fixtures; it does not require AWS access.

## Run the server

Copy `.env.example` to `.env`, configure storage, and choose a database path. Use an absolute `DATABASE_PATH` during development so migrations and Vite open the same SQLite file.

```sh
bun run db:migrate
bun run --filter @postplan/web dev
```

Set variables in the shell or create `apps/web/.env` for Bun to load. Run server package commands from `apps/web` when they depend on its React JSX configuration. Rebuild shared packages after changing their exports.

SQLite startup seeds configured accounts and keys but does not apply schema changes. Review and run migrations before starting the service. DynamoDB uses an explicit bootstrap command. See [database operations](../apps/web/DATABASE.md).

## Workspace

```text
apps/
  cleanup/         AWS cleanup executable and S3 deletion adapter
  cli/             CLI source, agent skill, and bundled executable
  server/          Bun host, TanStack Start application, OAuth, and storage
packages/
  api/             oRPC contract, schemas, routes, and client types
  store/           Internal oRPC store contracts and shared domain helpers
  store-drizzle/   Drizzle/SQLite stores, schema, migrations, and driver tests
  store-dynamodb/  DynamoDB stores, cleanup, and local test fixture
scripts/           Workspace setup and provider-specific test preloads
```

Useful commands:

```sh
turbo run quality
turbo run quality:fix
bun run db:generate
bun run pack:cli
```

TanStack Router generates `apps/web/src/frontend/routeTree.gen.ts` before builds and type checks. Commit the generated file and do not edit it by hand.

## Container image

```sh
docker build --tag postplan:local .
```

The image runs compiled JavaScript with Bun as a non-root user. Mount persistent storage for SQLite; do not keep the database only in the container layer. CI builds and tests the image but does not deploy it.
