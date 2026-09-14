import assert from "node:assert/strict";
import { test } from "bun:test";
import { validateHtml } from "#lib/html-policy";

const page = (body: string, head = "<title>Plan</title>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("accepts a plain document and extracts the title", () => {
  const result = validateHtml(page("<h1>Hello</h1>"));
  assert.equal(result.ok, true);
  assert.equal(result.title, "Plan");
  assert.deepEqual(result.warnings, []);
});

test("rejects empty and non-string input", () => {
  assert.equal(validateHtml("   ").ok, false);
  assert.equal(validateHtml(undefined).ok, false);
  assert.equal(validateHtml(42).ok, false);
});

test("allows inline classic script but flags it in stats", () => {
  const result = validateHtml(page("<script>console.log(1)</script>"));
  assert.equal(result.ok, true);
  assert.equal(result.stats.hasInlineScript, true);
});

test("rejects external and module scripts", () => {
  assert.match(
    validateHtml(page('<script src="https://x.test/a.js"></script>')).errors.join(),
    /External script/,
  );
  assert.match(
    validateHtml(page('<script type="module">1</script>')).errors.join(),
    /Unsupported script type/,
  );
});

test("rejects blocked tags, handlers, and meta refresh", () => {
  for (const [html, pattern] of [
    ["<form></form>", /<form>/],
    ["<iframe></iframe>", /<iframe>/],
    ['<img src="a.png" onerror="x()">', /onerror/],
    ['<a srcdoc="x">a</a>', /srcdoc/],
  ] as const) {
    assert.match(validateHtml(page(html)).errors.join(), pattern);
  }
  assert.match(
    validateHtml(
      page("", '<title>t</title><meta http-equiv="refresh" content="0;url=https://x.test">'),
    ).errors.join(),
    /meta refresh/,
  );
});

test("rejects javascript: URLs even with embedded control characters", () => {
  const sneaky = `<a href="java\nscript:alert(1)">x</a>`;
  const spaced = `<a href="  \tjavascript:alert(1)">x</a>`;
  const tabbed = `<a href="java\tscript:alert(1)">x</a>`;
  for (const body of [sneaky, spaced, tabbed]) {
    assert.match(validateHtml(page(body)).errors.join(), /unsafe URL/, body);
  }
  assert.equal(validateHtml(page('<a href="https://example.com">x</a>')).ok, true);
});

test("records external image hosts, sorted and de-duplicated", () => {
  const result = validateHtml(
    page(
      '<img src="https://b.test/1.png"><img src="//a.test/2.png"><img src="https://b.test/3.png"><img src="rel.png">',
    ),
  );
  assert.deepEqual(result.stats.externalImageHosts, ["a.test", "b.test"]);
});

test("enforces the byte limit and nesting depth", () => {
  assert.match(
    validateHtml(page("x".repeat(100)), { maxBytes: 50 }).errors.join(),
    /maximum is 50 bytes/,
  );
  const deep = "<div>".repeat(600) + "</div>".repeat(600);
  assert.match(validateHtml(page(deep)).errors.join(), /nested more than 512/);
});

test("warns when there is no title", () => {
  const result = validateHtml(page("<p>x</p>", ""));
  assert.equal(result.ok, true);
  assert.equal(result.title, null);
  assert.equal(result.warnings.length, 1);
});
