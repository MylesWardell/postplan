import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
for (const h of ['<title>t</title><select><img src=x onerror="alert(1)"></select>', '<title>t</title><select><div><a href="javascript:alert(1)">x</a></div></select>', '<title>t</title><select><iframe src="https://evil.test"></iframe></select>'])
  console.log(validateHtml(h).ok, validateHtmlWasm(h).ok, h);
