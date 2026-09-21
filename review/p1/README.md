# Issue #29 priority 1 — review bundle

Throwaway code behind the "Fifth pass" section of
`docs/cloudflare-optimization-investigation.md` (PR #31). It was built in the
gitignored `.local/p1/` and copied here so it can be reviewed. None of it is
production code, and production validation (`packages/store/src/html-policy.ts`)
is unchanged.

The question: can upload validation swap parse5 for a WebAssembly html5ever
build and be **cheaper without being less safe**? The doc claims yes on safety
and "only for large uploads" on cost. This bundle is what those claims rest on.

## What to review, in priority order

1. **Is the oracle a fair judge?** Everything security-related rests on it.
   - `oracle-dom.ts` — the production policy re-implemented over a browser DOM.
     It must match `packages/store/src/html-policy.ts` rule for rule. Any drift
     makes every "0 unsafe accepts" number wrong.
   - `oracle-server.ts` — how Chrome parses each document (`DOMParser`,
     scripting off, declarative shadow roots stay as `<template>`). Check that
     this matches how a real browsing context would treat the served bytes.
   - `oracle-shared.ts` — `asServed()` (well-formed UTF-16 + strip one leading
     BOM, i.e. what the Worker actually serves), `digest()`, the corpus
     generators. The corpus in here was lifted verbatim from `differential.ts`.
   - `oracle-compare.ts` — `classify()`. Key choices to challenge:
     `unsafeAccept`/`missedScript`/`missedHost` count only when the side accepts
     (`ok && !deep`). Empty documents are skipped. `xlink:href` and `href` error
     wording is normalised. Production is scored against Chrome without the
     template walk, the candidate with it.
2. **Does the Rust policy mirror the JS policy?**
   `policy-wasm-040p/src/lib.rs`, plus the JS glue in `candidate.ts` (input
   checks, title trim/slice, host classification, dedup). Claimed to match
   exactly, including ECMAScript trim/whitespace, ASCII-only lowercasing, the
   non-unicode `/i` style regex, the UTF-16 `slice(0, 140)` title cut and error
   de-duplication.
3. **Are the html5ever patches right?**
   `html5ever-patch/html5ever-0.40.1-postplan.patch` (8 hunks, applies cleanly to
   crates.io `html5ever-0.40.1` with `patch -p1`). Six changes, each from a
   Chrome-confirmed minimal repro:
   - CDATA: `adjusted_current_node_present_but_not_in_html_namespace` must
     exclude MathML text and HTML integration points.
   - `InTableBody` `table_outer` set: `"table"` should be `"thead"` (upstream bug).
   - `InTable` `<form>` inside template contents is inserted, not dropped.
   - NUL tokens are ignored in every mode before `InBody`.
   - U+FFFD does not clear frameset-ok for body/foreign character tokens
     (foster-parented text still does).
   - Implying `<body>` from `AfterHead` resets frameset-ok to true.
     These match Blink. Check whether each also matches the WHATWG spec, and
     whether any is too broad.
4. **Benchmark wiring.** `bench/html-policy-wasm.ts` (Worker glue) and
   `bench/wasm-policy.sh` (the `BENCH_PATCH` that swaps the module in, marks the
   `.wasm` import external, copies it into `dist/server/` and appends a
   `CompiledWasm` rule to the generated `wrangler.json`).

## Claims to verify

| Claim (from the doc)                                                        | Where                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Candidate: 0 unsafe accepts, 0 missed scripts, 0 missed hosts, 6 seeds      | `results/oracle-compare-*.json` → `<corpus>.candidate.counts`      |
| Production: 1,060/979/1,037 and 1,001/992/1,049 unsafe accepts per seed     | same files → `<corpus>.production.counts`                          |
| All 36 "stricter" + 5 "extraScript" are `<select><button><selectedcontent>` | same files → `.candidate.examples` (examples are `[html, chrome]`) |
| 124 errorsDiff = 63 select + 54 depth + 4 cand-extra + 3 cand-missing       | same                                                               |
| Seeds 4–6 are a true holdout (no patch derived from them)                   | only the timeline; seeds 4–6 were judged after the last patch      |
| WPT 1,959 cases, both sides all-zero                                        | `results/oracle-chrome-wpt.json` + compare files                   |

The three "candidate reports one error fewer than Chrome" cases are the ones
I'd look at hardest: they are in documents both sides reject, but they are the
shape a real gap would take.

## Layout

```
candidate.ts             JS glue loading the wasm build (POLICY_WASM=policy-wasm-040p)
differential.ts          parse5-vs-candidate differential (WPT + targeted + fuzz)
html-policy-templates.ts production policy + template walk (for the parse5 differential)
oracle-shared.ts         corpus generators, digest(), asServed()
oracle-dom.ts            the policy over a browser DOM
oracle-server.ts         serves the oracle page to headless Chrome, stores digests
oracle-compare.ts        scores production and candidate against Chrome
oracle-show.ts           prints prod/cand/chrome digests for examples
oracle-minimize.ts       delta-debugger with Chrome in the loop (/judge)
chrome-probe.ts          dumps Chrome's tree for a few inputs
min-*.ts, minimize.ts    parse5-vs-candidate minimisers
micro.ts                 Node micro-benchmark
run-slices.sh            drives Chrome over a seed in slices (see caveat below)
merge-parts.ts           joins slices into oracle-chrome-fuzz-<seed>.json
policy-wasm-040p/        the Rust crate, plus the built .wasm used for every result
html5ever-patch/         the vendored html5ever changes as a patch
bench/                   Worker glue and the benchmark patch script
wpt/                     WPT html/syntax/parsing .dat files at 8460f63
results/                 compare outputs (counts + up to 200 examples per category)
scratch/                 one-off exploration scripts, kept for provenance only
```

## Reproducing

From the repo root (needs `bun install` done, Chrome at the default Windows
path, and Rust with `wasm32-unknown-unknown` only if rebuilding):

```sh
# Rebuild the module (optional; a built copy is included).
# Point [patch.crates-io] in policy-wasm-040p/Cargo.toml at a patched html5ever-0.40.1 first.
(cd review/p1/policy-wasm-040p && cargo build --release --target wasm32-unknown-unknown)

# Chrome digests (not included: 52 MB per seed).
bun review/p1/oracle-server.ts &            # 127.0.0.1:5287
#   WPT + targeted: load http://127.0.0.1:5287/?seeds=0&count=0 once in headless Chrome
#   (flags as in run-slices.sh; seed 0 with count 0 is an empty placeholder), then per seed:
bash review/p1/run-slices.sh 4 0 200000 5000 120
bun review/p1/merge-parts.ts 4 200000

# Score.
POLICY_WASM=policy-wasm-040p bun review/p1/oracle-compare.ts 4,5,6 200000
```

Caveat on `run-slices.sh`: Chrome only stays alive past page load under
`--virtual-time-budget`, and under virtual time parsed documents are never
garbage-collected. A whole 200k seed in one page load grows the renderer past
15 GB and crashes it; 5k slices finish in about a second each.

`differential.ts` reproduces the older parse5-vs-candidate table:
`TEMPLATES=1 POLICY_WASM=policy-wasm-040p bun review/p1/differential.ts 200000 1 1`
(args: fuzz count, seed, dsd).
