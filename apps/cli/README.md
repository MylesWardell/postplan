# Postplan CLI

Build from the workspace root with `bun run build --filter=postplan...`. tsdown bundles the CLI into `apps/cli/bin/postplan.js`; external runtime dependencies are declared in this package.

```sh
node apps/cli/bin/postplan.js auth login --api-url https://plans.example.com
node apps/cli/bin/postplan.js auth set <api-key> --api-url https://plans.example.com
node apps/cli/bin/postplan.js upload ./plan.html --api-url https://plans.example.com
node apps/cli/bin/postplan.js list --api-url https://plans.example.com
bun run pack:cli
```

The tarball is written to the root `dist/` directory and includes the executable, source map and agent skill. Credentials and draft mappings remain in `~/.postplan`. The CLI continues using the stable REST compatibility API, so existing clients and stored mappings keep working.

Every upload requires a valid API key. Use `auth login` to open the dashboard and create a key, then save it with `auth set`, or set `POSTPLAN_API_KEY` for automation. Anonymous uploads are unsupported. Legacy anonymous draft mappings cannot be updated; use `upload --new` to publish a new draft under your account.
