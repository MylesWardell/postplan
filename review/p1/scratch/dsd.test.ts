import { test } from "vitest";
import { validateHtml } from "../../packages/store/src/html-policy";
test("dsd", () => {
  for (const h of [
    '<title>t</title><div><template shadowrootmode="open"><iframe src="https://evil.test"></iframe><img src=x onerror="alert(1)"><form action="javascript:alert(1)"><button>x</button></form></template></div>',
    '<title>t</title><template><img src=x onerror="alert(1)"></template>',
    '<title>t</title><script src="https://x/a.js"></script>',
  ]) console.log(JSON.stringify(validateHtml(h)));
});
