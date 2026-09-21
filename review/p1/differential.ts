// Differential gate: production parse5 policy vs html5ever WASM candidate.
// Usage: bun review/p1/differential.ts [fuzzCount=20000] [seed=20260917] [dsd=0]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateHtml as validateProduction, type HtmlValidationResult } from "../../packages/store/src/html-policy";
import { validateHtml as validateTemplates } from "./html-policy-templates";
const walkTemplates = process.env.TEMPLATES === "1";
const validateHtml = walkTemplates ? validateTemplates : validateProduction;
import { validateHtmlWasm } from "./candidate";

const fuzzCount = Number(process.argv[2] ?? 20000);
const seed = Number(process.argv[3] ?? 20260917);
const dsd = process.argv[4] === "1";

type Outcome = HtmlValidationResult | { thrown: string };

function run(fn: () => HtmlValidationResult): Outcome {
  try {
    return fn();
  } catch (error) {
    return { thrown: String(error).slice(0, 80) };
  }
}

const categories = {
  unsafeAccept: [] as string[],
  missedScript: [] as string[],
  stricter: [] as string[],
  extraScript: [] as string[],
  errorsDiff: [] as string[],
  errorOrderDiff: [] as string[],
  titleDiff: [] as string[],
  hostsDiff: [] as string[],
  illFormedTextDiff: [] as string[],
  thrown: [] as string[],
};
type Category = keyof typeof categories;

function compare(html: string, counts: Map<Category, Set<string>>): void {
  const prod = run(() => validateHtml(html));
  const cand = run(() => validateHtmlWasm(html, { dsd, walkTemplates }));
  const hit = (category: Category) => {
    let set = counts.get(category);
    if (!set) counts.set(category, (set = new Set()));
    set.add(html);
  };
  if ("thrown" in prod || "thrown" in cand) {
    if (!("thrown" in prod && "thrown" in cand)) hit("thrown");
    // A production throw is a rejected upload (500); candidate must not accept.
    if ("thrown" in prod && !("thrown" in cand) && cand.ok) hit("unsafeAccept");
    return;
  }
  if (cand.ok && !prod.ok) hit("unsafeAccept");
  if (!cand.ok && prod.ok) hit("stricter");
  if (prod.hasScripts && !cand.hasScripts) hit("missedScript");
  if (!prod.hasScripts && cand.hasScripts) hit("extraScript");
  const a = [...prod.errors].toSorted().join("\n");
  const b = [...cand.errors].toSorted().join("\n");
  // Lone UTF-16 surrogates become U+FFFD in the UTF-8 hand-off; that only
  // changes message/title text, so track it apart from real text diffs.
  const wellFormed = html.isWellFormed();
  if (a !== b) hit(wellFormed ? "errorsDiff" : "illFormedTextDiff");
  else if (prod.errors.join("\n") !== cand.errors.join("\n")) hit("errorOrderDiff");
  if (prod.title !== cand.title) hit(wellFormed ? "titleDiff" : "illFormedTextDiff");
  if (prod.stats.externalImageHosts.join() !== cand.stats.externalImageHosts.join()) hit("hostsDiff");
}

// ---- corpora ---------------------------------------------------------------

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

const page = (body: string, head = "<title>Plan</title>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const targeted = [
  page("<h1>Hello</h1>"),
  page("<script>console.log(1)</script>"),
  page('<script src="https://x.test/a.js"></script>'),
  page('<script type="module">1</script>'),
  page('<script type=" TEXT/JavaScript ">1</script>'),
  ...["form", "iframe", "object", "embed", "applet", "base", "link"].map((t) => page(`<${t}></${t}>`)),
  page('<img src="a.png" onerror="x()">'),
  page('<a srcdoc="x">a</a>'),
  page("", '<title>t</title><meta http-equiv=" REFRESH " content="0;url=https://x.test">'),
  page(`<a href="java\nscript:alert(1)">x</a>`),
  page(`<a href="  \tjavascript:alert(1)">x</a>`),
  page(`<a href=" javascript:alert(1)">x</a>`),
  page(`<a href="﻿javascript:alert(1)">x</a>`),
  page(`<a href="java&#x09;script:alert(1)">x</a>`),
  page(`<a href="JaVaScRiPt:alert(1)">x</a>`),
  page('<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'),
  page('<svg><script href="data:,x"></script></svg>'),
  page("<math><mtext><script>1</script></mtext></math>"),
  page('<div style="width: EXPRESSION (1)">x</div>'),
  page('<div style="background:url(\n javascript:alert(1))">x</div>'),
  page('<div style="behavior : url(x.htc)">x</div>'),
  page('<img src="https://b.test/1.png"><img src="//a.test/2.png"><img src="rel.png"><img src="data:image/png;base64,">'),
  page("<noscript><iframe></iframe></noscript>"),
  page("<noscript><script>1</script></noscript>"),
  page("<template><iframe></iframe></template>"),
  page('<div><template shadowrootmode="open"><iframe></iframe></template></div>'),
  page("<div>".repeat(600) + "</div>".repeat(600)),
  page("<div>".repeat(510) + "x" + "</div>".repeat(510)),
  page("<div>".repeat(511) + "x" + "</div>".repeat(511)),
  page("<b>".repeat(600) + "x"),
  page("<table><tr><td><iframe></iframe></td></tr></table>"),
  page("<table><form><input></form></table>"),
  page("<select><iframe></iframe><script>1</script></select>"),
  page("<svg><title>SVG title</title></svg>", ""),
  page("<p>x</p>", ""),
  page("", "<title>  </title><title>second</title>"),
  page("", `<title>${"é".repeat(300)}</title>`),
  page("", `<title>${"😀".repeat(100)}</title>`),
  "<plaintext><iframe>",
  "<frameset><frame src=javascript:1></frameset>",
  "<xmp><iframe></xmp>",
  "<textarea><iframe></textarea>",
  "<style><iframe></style>",
  "<noembed><iframe></noembed>",
  "<noframes><iframe></noframes>",
  "<isindex action=javascript:1>",
  "<image src=//c.test/x>",
  "<svg><foreignObject><iframe></iframe></foreignObject></svg>",
  "<math><annotation-xml encoding=text/html><iframe></iframe></annotation-xml></math>",
  "<svg><font color=red><iframe>",
  "<a><table><a><iframe>",
  "<ONCLICK onCLICK=1>",
  "\0<script\0>",
  "<svg><![CDATA[<iframe>]]></svg>",
  "<!--<iframe>-->",
  "<select><selectedcontent></selectedcontent><option><iframe>",
];

// ---- deterministic fuzz ------------------------------------------------------

function prng(state: number) {
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAGS = `html head body title style script noscript template svg math foreignObject desc
annotation-xml mi mo mn ms mtext mglyph malignmark table tbody thead tfoot tr td th caption colgroup
col select option optgroup datalist textarea plaintext xmp iframe noembed noframes frameset frame form
button input keygen a b i u s em strong nobr p div span li ul ol dl dd dt h1 h2 marquee object embed
param img image meta link base applet isindex listing pre font center hr br area source track
selectedcontent search dialog details summary main ruby rt rp rb rtc html:x x-y DIV SCRIPT sCrIpT
IFRAME Svg MATH foreignobject`.split(/\s+/);
const ATTRS = [
  "onclick=x", "ONLOAD=1", "onerror", "on=1", "one", "src=//a.test/x.png", 'src="https://b.test/y"',
  'href="java&#x09;script:1"', 'href=" javascript:1"', "href=javascript:1", "xlink:href=javascript:1",
  'href="&#106;avascript:1"', "href=vbscript:1", "src=file:///x", "action=javascript:1",
  "formaction=javascript:1", "poster=javascript:1", "srcdoc=x", "type=module", 'type="text/javascript "',
  "type=text/plain", "http-equiv=Refresh", "http-equiv=refresh content=0", 'style="x:expression(1)"',
  'style="background:url( javascript:x)"', "style=behavior:url(x)", "encoding=text/html",
  "encoding=application/xhtml+xml", "color=red", "face=x", "size=1", "shadowrootmode=open",
  "shadowrootmode=closed", "definitionURL=javascript:1", "xmlns=http://www.w3.org/1999/xhtml",
  "xmlns:xlink=x", "id=a", "class=b", 'title="x"', "src", "type", "multiple", "selected",
];
const PIECES = [
  "<!--", "-->", "--!>", "<![CDATA[", "]]>", "</", "<", ">", "/>", '"', "'", "=", "&lt;", "&amp",
  "&#0;", "\0", "\r\n", "\r", "<!doctype html>", "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\">",
  "<?pi x?>", "javascript:", " ", " ", "\t", "text", "x", "</script", "<!--<script>", "﻿",
  "😀", "<!>", "</>", "<a b c>", "</p>", "</br>", "</table>", "</template>", "</svg>", "</math>",
  "</select>", "</body>", "</html>", "</head>", "</title>", "</noscript>", "</foreignObject>",
];

function generate(random: () => number, wpt: string[]): string {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  const tag = () => {
    const name = pick(TAGS);
    let out = (random() < 0.3 ? "</" : "<") + name;
    const n = Math.floor(random() * 4);
    for (let i = 0; i < n; i++) out += pick([" ", "\n", "/", " \t"]) + pick(ATTRS);
    if (random() < 0.1) out += "/";
    if (random() < 0.93) out += ">";
    return out;
  };
  let html = random() < 0.25 ? pick(wpt) : "";
  const count = 1 + Math.floor(random() * 40);
  for (let i = 0; i < count; i++) {
    const piece = random() < 0.6 ? tag() : pick(PIECES);
    if (html && random() < 0.4) {
      const at = Math.floor(random() * (html.length + 1));
      html = html.slice(0, at) + piece + html.slice(at);
    } else {
      html += piece;
    }
  }
  if (random() < 0.05) html = pick(["<div>", "<b>", "<svg>", "<table>", "<a>"]).repeat(500 + Math.floor(random() * 30)) + html;
  return html;
}

// ---- run -------------------------------------------------------------------------

function report(name: string, inputs: string[]) {
  const counts = new Map<Category, Set<string>>();
  for (const html of inputs) compare(html, counts);
  const summary: Record<string, number> = { inputs: inputs.length };
  for (const key of Object.keys(categories) as Category[]) summary[key] = counts.get(key)?.size ?? 0;
  console.log(name, JSON.stringify(summary));
  const unsafe = new Set([...(counts.get("unsafeAccept") ?? []), ...(counts.get("missedScript") ?? [])]);
  console.log(`${name} uniqueUnsafe=${unsafe.size}`);
  return { summary, examples: Object.fromEntries([...counts].map(([k, v]) => [k, [...v]])) };
}

const wpt = wptInputs();
const random = prng(seed);
const fuzz = Array.from({ length: fuzzCount }, () => generate(random, wpt));
const results = {
  seed,
  dsd,
  wpt: report("wpt", wpt),
  targeted: report("targeted", targeted.filter((h) => h.trim())),
  fuzz: report("fuzz", fuzz),
};
writeFileSync(new URL(`./differential-${process.env.POLICY_WASM ?? "policy-wasm"}-${seed}-${fuzzCount}${dsd ? "-dsd" : ""}${walkTemplates ? "-templates" : ""}.json`, import.meta.url), JSON.stringify(results, null, 2));
