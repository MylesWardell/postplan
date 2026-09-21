// Local server for the Chrome oracle. Serves the page, the transpiled shared
// modules and the WPT corpus, and stores the digests Chrome posts back.
// bun review/p1/oracle-server.ts [port=5287]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 5287);
const here = new URL("./", import.meta.url);
const transpiler = new Bun.Transpiler({ loader: "ts" });

function wptInputs(): string[] {
  const dir = new URL("./wpt/html/syntax/parsing/resources/", import.meta.url);
  const inputs: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".dat")).toSorted()) {
    const text = readFileSync(new URL(file, dir), "utf8");
    for (const block of text.split(/\n(?=#data\n)/)) {
      if (!block.startsWith("#data\n")) continue;
      const end = block.indexOf("\n#errors");
      inputs.push(block.slice(6, end));
    }
  }
  return inputs;
}

const wpt = JSON.stringify(wptInputs());

const page = `<!doctype html><meta charset=utf-8><title>oracle idle</title>
<script type=module>
import { targeted, fuzzCorpus, digest, asServed } from "/oracle-shared.js";
import { policyDom } from "/oracle-dom.js";

const parser = new DOMParser();
const judge = (html) => {
  try {
    const doc = parser.parseFromString(asServed(html), "text/html");
    return [digest(policyDom(doc, true)), digest(policyDom(doc, false))];
  } catch (error) {
    const threw = "threw:" + String(error).slice(0, 60);
    return [threw, threw];
  }
};

// Self-check: DOMParser documents must parse with scripting disabled.
const probe = parser.parseFromString("<noscript><p id=x></p></noscript>", "text/html");
if (!probe.getElementById("x")) throw new Error("DOMParser parsed <noscript> as raw text");

async function run(name, inputs) {
  const out = [];
  for (let i = 0; i < inputs.length; i++) {
    out.push(judge(inputs[i]));
    if (i % 2000 === 1999) {
      document.title = name + " " + (i + 1) + "/" + inputs.length;
      await new Promise((r) => setTimeout(r));
    }
  }
  await fetch("/result?name=" + encodeURIComponent(name), { method: "POST", body: JSON.stringify(out) });
}

const params = new URLSearchParams(location.search);
const wpt = await (await fetch("/wpt.json")).json();
if (!params.has("nobase")) {
  await run("wpt", wpt);
  await run("targeted", targeted.filter((h) => h.trim()));
}
// Each page load judges one slice, so the renderer never holds more than a
// few thousand parsed documents (virtual time leaves them uncollected).
const count = Number(params.get("count") ?? 200000);
const from = Number(params.get("from") ?? 0);
const to = Math.min(count, Number(params.get("to") ?? count));
for (const seed of (params.get("seeds") ?? "1").split(",").map(Number)) {
  const corpus = fuzzCorpus(seed, count, wpt);
  const name = params.has("from") ? "fuzz-" + seed + "-p" + from : "fuzz-" + seed;
  await run(name, corpus.slice(from, to));
}
document.title = "oracle done";
</script>`;

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/wpt.json") return new Response(wpt, { headers: { "content-type": "application/json" } });
    // Synchronous batch judgement for headless --dump-dom (used by the minimiser).
    if (url.pathname === "/judge") {
      const cases = readFileSync(new URL("probe-cases.json", here), "utf8").replaceAll("<", "\\u003c");
      const judgePage = `<!doctype html><meta charset=utf-8><pre id=out></pre><script type=module>
import { digest, asServed } from "/oracle-shared.js";
import { policyDom } from "/oracle-dom.js";
const parser = new DOMParser();
document.getElementById("out").textContent = JSON.stringify(${cases}.map((h) =>
  digest(policyDom(parser.parseFromString(asServed(h), "text/html"), true))));
</script>`;
      return new Response(judgePage, { headers: { "content-type": "text/html" } });
    }
    const module = url.pathname.match(/^\/(oracle-shared|oracle-dom)\.js$/);
    if (module) {
      const source = readFileSync(new URL(`${module[1]}.ts`, here), "utf8");
      return new Response(transpiler.transformSync(source), { headers: { "content-type": "text/javascript" } });
    }
    if (url.pathname === "/result" && request.method === "POST") {
      const name = url.searchParams.get("name") ?? "";
      if (!/^[a-z0-9-]+$/.test(name)) return new Response("bad name", { status: 400 });
      writeFileSync(new URL(`oracle-chrome-${name}.json`, here), await request.text());
      console.log("stored", name);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`oracle server on http://127.0.0.1:${port}/`);
