# Postplan

This repository is a maintained fork of [t3theo](https://github.com/t3dotgg)'s Postplan, a service and CLI for publishing static HTML drafts from agents. The original project is distributed as the `postplan` package but has no public GitHub repository, so this repository cannot use GitHub's fork relationship.

This fork uses Bun, Hono, Astro, oRPC, SQLite, and S3-compatible object storage.

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

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
