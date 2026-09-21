# Private HTML validator

Experimental Rust/html5ever policy implementation compiled to Wasm and exposed through a private Cloudflare Worker service binding. It has no D1/R2 bindings; HTTP always returns 404. Upload storage stays in the TypeScript Worker.

The package includes the candidate parser changes reviewed in [PR #32](https://github.com/MylesWardell/postplan-clone/pull/32), not the entire review bundle. See [vendor provenance](vendor/README.md) for pinned source, licenses and the exact patch. These patches are experimental and do not establish equivalence with every browser. The existing application still uses parse5.

`validate(html, {maxBytes, maxDepth})` returns the shared policy result, including title, script presence, warnings and external image hosts. The upload experiment uses 32768 bytes and depth 64. Depth is checked on the parsed tree, not as an early parser CPU cutoff; a byte/depth limit is not a CPU guarantee.

The Rust toolchain and Cargo lockfile are pinned. Build the store package first, then run:

```sh
bun run rust:test
bun run validator:test
bun run worker:build
```

The checks include 3 native Rust tests and 20 workerd RPC cases. `worker:build` performs a dry run. Deploy only to an explicitly selected private test service with Wrangler; connect the upload Worker using `HTML_VALIDATOR`. The package is included to reproduce the matched upload-adapter experiment, not to promote the candidate parser into the main application.
