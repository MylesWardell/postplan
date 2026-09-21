import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
for (const h of [
  "<title>t</title><svg><title><![CDATA[><!--]]><img src=x onerror=alert(1)>-->",
  "<title>t</title><math><mtext><![CDATA[><!--]]><iframe src=https://e.test></iframe>-->",
  "<title>t</title><table><tr><template><td></table><iframe>",
]) { const p = validateHtml(h), c = validateHtmlWasm(h); console.log("prod", p.ok, "cand", c.ok, JSON.stringify(h)); }
