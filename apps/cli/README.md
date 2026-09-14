# Postplan CLI

Build from the workspace root with `bun run build --filter=postplan...`. tsdown bundles the CLI into `apps/cli/bin/postplan.js`; external runtime dependencies are declared in this package.

```sh
node apps/cli/bin/postplan.js upload ./plan.html --api-url https://plans.example.com
node apps/cli/bin/postplan.js auth login --api-url https://plans.example.com
node apps/cli/bin/postplan.js list --api-url https://plans.example.com
bun run pack:cli
```

The tarball is written to the root `dist/` directory and includes the executable, source map and agent skill. Credentials and draft mappings remain in `~/.postplan`. The CLI continues using the stable REST compatibility API, so existing clients and stored mappings keep working.
