# Postplan

This repository is a maintained fork of [t3theo](https://github.com/t3dotgg)'s Postplan, a service and CLI for publishing static HTML drafts from agents. The original project is distributed as the `postplan` package but has no public GitHub repository, so this repository cannot use GitHub's fork relationship.

This fork uses Bun, Hono, Astro, oRPC, SQLite, and S3-compatible object storage.

## Run locally

Install Bun 1.4.2+ and Node 26.8.2+. The simplest local setup uses Wrangler's local D1, R2 and Durable Object emulators; no cloud account or S3 server is needed.

Create `packages/cloudflare/.dev.vars` (ignored by Git):

```dotenv
POSTPLAN_RATE_LIMIT_SECRET=local-development-only
```

From the repository root:

```sh
bun install --frozen-lockfile
bunx --no-install turbo run cf:build --filter=@postplan/cloudflare
cd packages/cloudflare
bun deploy/initialize.ts --local
bunx --no-install wrangler dev --env-file .dev.vars --config dist/server/wrangler.json --persist-to .wrangler/state --local --port 5173 --var POSTPLAN_APPLICATION_ENABLED:true --var POSTPLAN_ALLOW_ANONYMOUS_UPLOADS:true --var POSTPLAN_SESSION_SECRET:local-session-only
```

Open **http://localhost:5173**. Data stays in `packages/cloudflare/.wrangler/state`; Ctrl+C stops the server. This local setup permits anonymous uploads and uses development-only secrets. Dashboard sign-in uses Shoo and needs internet access. Rebuild after code changes.

For the Bun/SQLite + S3 setup, see [development](docs/development.md) and [configuration](docs/configuration.md). Run `bun run check` from the root before committing.

## Deployment options

The Cloudflare Worker deployment was built for my personal use, optimized to be mostly free to run, with efficiency as the priority. The serverless Lambda deployment was built for my company, whose infrastructure runs on AWS. Both use the same application with platform-specific storage and runtime adapters.

## Documentation

- [CLI usage](docs/cli.md)
- [Development](docs/development.md)
- [Configuration and authentication](docs/configuration.md)
- [Architecture and API](docs/architecture.md)
- [AWS deployment](infra/terraform/README.md)
- [Cloudflare deployment](packages/cloudflare/README.md)
- [Benchmarks](benchmark/cloudflare/README.md)
- [Database operations](apps/web/DATABASE.md)

## Licence

The original Postplan package is Copyright (c) 2026 t3dotgg and licensed under the MIT Licence. This repository includes the original licence verbatim in [LICENSE](LICENSE).
