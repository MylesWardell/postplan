# CLI usage

Upload an HTML draft:

```sh
bunx postplan upload ./plan.html
```

The CLI defaults to `https://postplan.dev`. Pass `--api-url http://localhost:3000` to use a local or custom deployment.

Add a dashboard label with `--description`. Uploading the same draft again with a description updates the label; omitting the option leaves the existing label unchanged.

```sh
bunx postplan upload ./plan.html --description "Q3 warehouse migration plan"
```

Sign in to create and store an API key:

```sh
bunx postplan auth login
```

The command opens a browser page and asks you to paste the generated key back into the terminal, so it also works over SSH. You can set a key without the browser flow:

```sh
bunx postplan auth set <api-key>
```

List drafts owned by the signed-in account. The CLI follows every page of the bounded API list:

```sh
bunx postplan list
```

The CLI stores credentials and draft mappings in `~/.postplan`.

## Build the forked CLI

The fork is not published to the package registry. Build and package it from the workspace root:

```sh
bun run build --filter=postplan...
bun run pack:cli
```

The executable is `apps/cli/bin/postplan.js`; the package tarball is written to `dist/`. See [the CLI package notes](../apps/cli/README.md) for direct local commands.
