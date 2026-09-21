# Matched Hono and oRPC upload benchmark

Measured on Cloudflare on 2026-09-21 from SYD. Minimal Hono had **4-5 ms median caller CPU** per fixture. Adding one oRPC OpenAPI procedure cost **1-2.5 ms median paired CPU**. Hono versus bare fetch had a 0 ms median paired difference at the provider's integer-millisecond resolution.

Use Hono/direct validation for this upload experiment. This supports a median under 10 ms at the 32 KiB HTML cap, but not a per-request guarantee: Hono had one 15 ms request. The Rust validator remains a separate service; this experiment compares TypeScript adapters, not Rust versus TypeScript parsing.

## Results

Cells show median CPU, range, and count strictly below 10 ms. Twelve samples per cell; all 108 requests returned 201 and matched successful Cloudflare fetch invocations by Ray ID. No startup requests or outliers were discarded.

| HTML fixture           | Bare fetch         | Hono               | Hono + oRPC        |
| ---------------------- | ------------------ | ------------------ | ------------------ |
| 5,356 bytes, ordinary  | 4 ms (3-13), 11/12 | 4 ms (4-15), 11/12 | 7 ms (4-30), 9/12  |
| 32,768 bytes, ordinary | 4 ms (4-5), 12/12  | 5 ms (4-7), 12/12  | 6 ms (4-9), 12/12  |
| 32,768 bytes, dense    | 4 ms (4-6), 12/12  | 4 ms (4-6), 12/12  | 7 ms (4-13), 10/12 |

Pair each fixture and round within a batch, then subtract caller CPU:

| Fixture         | Hono minus bare, median / mean | oRPC minus Hono, median / mean |
| --------------- | ------------------------------ | ------------------------------ |
| 5,356 ordinary  | 0 / +0.167 ms                  | +2.5 / +3.917 ms               |
| 32,768 ordinary | 0 / +0.500 ms                  | +1 / +1.167 ms                 |
| 32,768 dense    | 0 / -0.167 ms                  | +2 / +2.750 ms                 |

A median of differences need not equal the difference of medians. Negative differences show runtime/measurement variation, not negative routing cost. Across all fixtures, batch 1 medians were bare 4 / Hono 5 / oRPC 8 ms; batch 2 medians were 4 / 4 / 5 ms. That warm-up dependence is why both batches are retained and no universal exact overhead is claimed. Separate isolates, JIT state and 1 ms quantization remain confounders. Twelve samples per fixture is exploratory evidence, not a tail-latency SLO.

Full allowlisted samples, CPU/wall-time statistics, versions and paired deltas are in [hono-upload-results.json](hono-upload-results.json). Raw exports remain ignored because they can contain authorization headers, IPs and draft identifiers.

## Matched design

Two 54-request batches, six rounds each, rotating and reversing arm order. Both batches used the same deployed versions. The shared IP quota window expired between batches. [run.mjs](../packages/cloudflare-upload/benchmark/run.mjs) contains the exact fixtures. Dense markup includes tables, SVG and image references; uploads do not fetch those images.

All arms share native D1/R2 upload code, input/output Zod schemas, bearer auth, account restriction, kill switch, HMAC-named DO quotas, lifetime storage reservations, hashing and metadata writes. The same private Rust service validates identical HTML with maxBytes 32768 and maxDepth 64. [bundle.mjs](../packages/cloudflare-upload/benchmark/bundle.mjs) verifies no oRPC runtime enters the direct controls. The oRPC arm constructs only one upload contract.

The module-scope Hono router handles only POST /api/uploads. The oRPC variant mounts an OpenAPIHandler under that same route. The common bounded reader reconstructs one unread Request for every arm. This avoids the [documented Body Already Used error](https://orpc.dev/docs/adapters/hono#body-already-used-error); no extra Hono JSON middleware or JSON reserialization is added to oRPC. Hono's [default preset](https://hono.dev/docs/api/presets) is used for the persistent Worker isolate.

Caller CPU excludes separate validator/DO execution. Median observed wall time ranged from 375.5 to 419.5 ms across fixture/arm groups, dominated by storage/network waits. Wall time is not CPU. Sleeping between parser iterations does not reduce the amount of CPU work.

## Artifacts

Base master: `64f89f7`. Hono 4.13.8; oRPC 2.0.0-beta.35; Wrangler 4.131.2; compatibility date 2026-09-18 with nodejs_compat. Local checks used Node 26.5.0 / Bun 1.3.14; CI uses the repository's Node 26.8.2 / Bun 1.4.2 pins. Rust 1.98.1.

| Arm         | Deployment version                   | Wrangler upload / gzip | Startup diagnostic |
| ----------- | ------------------------------------ | ---------------------- | ------------------ |
| Bare        | 00d769e4-dc56-4ee4-b9ef-4fe865b109c4 | 785.73 / 123.69 KiB    | 21 ms              |
| Hono        | 8d321af0-a459-4a9d-8f6f-1855e17d3cd1 | 848.31 / 138.77 KiB    | 24 ms              |
| Hono + oRPC | 31162858-d2ce-4cf9-a3f4-f9201672dc5b | 981.55 / 167.38 KiB    | 25 ms              |

Startup diagnostics are not upload CPU samples. Private validator version `3f6899f8-0afa-441f-8217-78ff6474530b` was held constant. Its html5ever patches remain an experimental candidate from PR #32, with provenance in the package. This benchmark does not establish browser security equivalence or replace the main application's parse5 policy.

## Validation and cleanup

Local validation: repository `bun run check`, upload typecheck and Wrangler dry-run build, 3 native Rust tests plus fmt/clippy, 20 workerd validator cases, and 51 upload acceptance requests across all adapters plus real DO quota checks. Acceptance covers concurrent versions, stored bytes/hash/metadata, invalid bodies, ownership, revoked keys, kill switch, exhausted budget and injected D1 failure with atomic rollback and retained reservation.

After measurement, the three temporary ingresses were disabled and their keys revoked. Exactly 108 allowlisted synthetic R2 objects were deleted and drafts tombstoned; audit rows and lifetime reservations were retained. The existing application and Postplan report remain in place. Committed configuration is private, disabled and uses placeholder storage IDs; this PR does not switch production traffic.

To reproduce analysis, save each arm's exports to ignored `{bare,hono,orpc}-logs.json`, retain runner outputs as `requests-{1,2}.json`, then run `python packages/cloudflare-upload/benchmark/analyze.py <ignored-directory> <sanitized-output.json>`. Missing/duplicate matches, mixed versions and unsuccessful requests fail analysis rather than being silently discarded.
