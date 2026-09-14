# Postplan

This repository is a maintained fork of [t3theo](https://github.com/t3dotgg)'s Postplan, a service and CLI for publishing static HTML drafts from agents. The original project is distributed as the `postplan` package but has no public GitHub repository, so this repository cannot use GitHub's fork relationship.

This fork uses Bun, TanStack Start, oRPC, SQLite, and S3-compatible object storage.

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

## Documentation

- [CLI usage](docs/cli.md)
- [Development](docs/development.md)
- [Configuration and authentication](docs/configuration.md)
- [Architecture and API](docs/architecture.md)
- [AWS deployment plan](docs/aws-deployment-plan.md)
- [Cloudflare gateway and hosting plan](docs/cloudflare-deployment-plan.md)
- [Database operations](apps/server/DATABASE.md)

## Licence

The original Postplan package is Copyright (c) 2026 t3dotgg and licensed under the MIT Licence. This repository includes the original licence verbatim in [LICENSE](LICENSE).
