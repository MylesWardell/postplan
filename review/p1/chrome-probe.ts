// Run parser probes in headless Chrome (isolated temp profile) via --dump-dom.
// bun review/p1/chrome-probe.ts '<json array of html strings>'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const arg = process.argv[2]!;
const cases: string[] = JSON.parse(arg.endsWith(".json") ? readFileSync(arg, "utf8") : arg);

const dir = mkdtempSync(join(tmpdir(), "p1-probe-"));
const page = join(dir, "probe.html");
writeFileSync(
  page,
  `<!doctype html><meta charset=utf-8><pre id=out></pre><script>
const cases = ${JSON.stringify(cases).replaceAll("<", "\\u003c")};
const parser = new DOMParser();
const describe = (node) => [...node.childNodes].map((n) =>
  n.nodeType === 1
    ? n.localName + (n.attributes.length ? "[" + [...n.attributes].map((a) => a.name).join(",") + "]" : "") +
      "(" + describe(n.localName === "template" ? n.content : n) + ")"
    : n.nodeType === 3 ? JSON.stringify(n.data) : "#" + n.nodeType).join(" ");
document.getElementById("out").textContent = JSON.stringify(
  cases.map((h) => ({ h, tree: describe(parser.parseFromString(h, "text/html")) })),
);
</script>`,
);
const proc = Bun.spawnSync([
  CHROME,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${join(dir, "profile")}`,
  "--dump-dom",
  pathToFileURL(page).href,
]);
const dom = proc.stdout.toString();
const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
rmSync(dir, { recursive: true, force: true });
if (!match) {
  console.error(dom.slice(0, 500), proc.stderr.toString().slice(0, 500));
  process.exit(1);
}
const decoded = match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
for (const { h, tree } of JSON.parse(decoded)) console.log(JSON.stringify(h), "=>", tree);
const version = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `(Get-Item '${CHROME}').VersionInfo.ProductVersion`]);
console.log("chrome", version.stdout.toString().trim());
