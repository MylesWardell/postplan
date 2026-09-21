# BENCH_PATCH: route @postplan/store/html-policy to the html5ever WASM policy.
# Runs from the root of the disposable copy before building.
#
# The Cloudflare Vite plugin's CompiledWasm handling does not apply to this
# app's ssr environment, so the wasm import is left external and the file is
# copied next to the built Worker, where Wrangler's default CompiledWasm module
# rule picks it up.
set -euo pipefail
src="${P1_DIR:?set P1_DIR to the review/p1 directory}"
wasm="${P1_WASM:-$src/policy-wasm-040p}/target/wasm32-unknown-unknown/release/policy_wasm.wasm"
cp "$src/bench/html-policy-wasm.ts" packages/cloudflare/src/html-policy-wasm.ts
cp "$wasm" packages/cloudflare/src/policy.wasm
python3 - <<'PY'
import json
from pathlib import Path

p = Path("apps/web/vite.config.ts")
s = p.read_text()
alias_old = 'alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)) },'
alias_new = ('alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)), '
             '"@postplan/store/html-policy": fileURLToPath(new URL("../../packages/cloudflare/src/html-policy-wasm.ts", import.meta.url)) },')
assert alias_old in s
s = s.replace(alias_old, alias_new)

plugins_old = "  plugins: [\n"
plugins_new = (
    "  plugins: [\n"
    '    { name: "p1-wasm-external", enforce: "pre" as const, resolveId(source: string) '
    '{ return source.endsWith("policy.wasm") ? { id: "./policy.wasm", external: true } : null; } },\n'
)
assert plugins_old in s
p.write_text(s.replace(plugins_old, plugins_new, 1))

pkg = Path("packages/cloudflare/package.json")
config = json.loads(pkg.read_text())
config["scripts"]["cf:build"] += (
    " && cp src/policy.wasm dist/server/policy.wasm"
    # Vite builds with no_bundle, so Wrangler needs a module rule to load the wasm.
    " && python3 -c \"import json,pathlib;"
    "p=pathlib.Path('dist/server/wrangler.json');c=json.loads(p.read_text());"
    "c['rules'].append({'type':'CompiledWasm','globs':['**/*.wasm']});"
    "p.write_text(json.dumps(c))\""
)
pkg.write_text(json.dumps(config, indent=2) + "\n")
PY
