import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
const cases: Record<string, string> = {
  bom: "\ufeff<title>t</title><frameset onload=alert(1)><frame src=https://e.test></frameset>",
  dsd: '<title>t</title><div><template shadowrootmode="open"><img src=https://track.test/x onerror=alert(1)></template></div>',
  relaxedSelect: "<title>t</title><select><img src=https://track.test/x onerror=alert(1)></select>",
  svgSelectDesc: "<title>t</title><svg><select><desc><select><select><img src=x onerror=alert(1)>",
};
for (const [k, h] of Object.entries(cases)) {
  const p = validateHtml(h), c = validateHtmlWasm(h, { walkTemplates: true });
  console.log(k.padEnd(14), "prod ok", p.ok, JSON.stringify(p.stats.externalImageHosts), "| cand ok", c.ok, JSON.stringify(c.errors));
}
