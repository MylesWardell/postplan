# html5ever 0.40.1

Source: <https://crates.io/crates/html5ever/0.40.1>, MIT OR Apache-2.0.
Both upstream licences are retained in `html5ever/`.

The upstream `.crate` archive SHA-256 is
`456a1a377e608e555d22ddab27ac0114bc7a7b4199078108e34c2aeae6c9b130`.
Only `src/tree_builder/mod.rs` and `src/tree_builder/rules.rs` differ from that
archive. `html5ever.patch` records the six changes reviewed in PR #32:
CDATA integration points, table-body scope, forms in template tables, NUL before
the body, replacement characters and frameset eligibility, and implied-body
frameset eligibility. Some match Blink behavior rather than proving compliance
across every browser; the crate remains an experimental candidate.

The parser source is checked in so clean builds do not depend on `.local/`,
manual patch application, or the original review bundle. Other dependencies are
pinned by the package's Cargo.lock. Formatting/lint checks exclude upstream code.
