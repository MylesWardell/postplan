import { describe, expect, it } from "vitest";
import { exports as worker } from "cloudflare:workers";
import type HtmlValidator from "../src/worker";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/worker");
    }
  }
}

const service: Service<HtmlValidator> = worker.default;

describe("private Rust validator service", () => {
  it("has no HTTP endpoint", async () => {
    expect((await service.fetch("https://validator/")).status).toBe(404);
  });
  it("returns metadata through a real RPC boundary", async () => {
    const result = await service.validate(
      '<title> Plan </title><script>1</script><img src="//B.test/x"><img src="https://a.test/y">',
    );
    expect(result).toEqual({
      ok: true,
      errors: [],
      warnings: [],
      title: "Plan",
      hasScripts: true,
      stats: { hasInlineScript: true, externalImageHosts: ["a.test", "b.test"] },
    });
  });
  it.each([
    '<div><template shadowrootmode="open"><iframe></iframe></template></div>',
    "<template><table><form onclick=x>",
    "\ufeff<frameset onload=x>",
    "&#0;<frameset onload=x>",
    "\ufffd<frameset onload=x>",
    "<template></template><l><frameset onload=x>",
    "<select><img src=x onerror=x>",
    "<svg><select><desc><select><select><img onerror=x>",
    "<noscript><iframe></iframe></noscript>",
    '<a href="java&#9;script:x">x</a>',
    '<script src="https://x.test/a.js"></script>',
    '<script type="module">1</script>',
    '<div style="width:EXPRESSION (1)">',
    '<meta http-equiv="refresh" content="0">',
  ])("rejects browser-visible policy violation: %s", async (html) => {
    expect((await service.validate(html)).ok).toBe(false);
  });
  it("enforces bytes, nesting and empty input", async () => {
    expect((await service.validate(`<p>${String.fromCharCode(0xd83d)}</p><iframe>`)).ok).toBe(
      false,
    );
    expect((await service.validate(" ")).ok).toBe(false);
    expect((await service.validate("界".repeat(175000))).errors[0]).toContain("maximum");
    expect((await service.validate("hello", { maxBytes: 4 })).ok).toBe(false);
    expect((await service.validate("x".repeat(524289), { maxBytes: 999999 })).ok).toBe(false);
    expect((await service.validate("<div>".repeat(600))).errors).toContain(
      "HTML is nested more than 512 levels deep.",
    );
  });
  it("does not leak results between interleaved requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        service.validate(`<title>${i}</title>${i % 2 ? "<iframe>" : "<p>safe</p>"}`),
      ),
    );
    results.forEach((result, i) => {
      expect(result.title).toBe(String(i));
      expect(result.ok).toBe(i % 2 === 0);
    });
  });
  it("preserves JS title truncation and URL semantics", async () => {
    const title = "x".repeat(139) + "😀";
    const result = await service.validate(
      `<title>${title}</title><img src="https://例え.test/a"><img src="/relative">`,
    );
    expect(result.title).toBe(title.slice(0, 140));
    expect(result.stats.externalImageHosts).toEqual(["xn--r8jz45g.test"]);
  });
});
import { validateHtml as parse5Validate } from "@postplan/store/html-policy";

it("enforces a configured depth boundary including text and template contents", async () => {
  const nested = (n: number) => "<div>".repeat(n) + "x" + "</div>".repeat(n);
  // document=0, html=1, body=2; 60 divs end at 62 and their text is 63.
  expect((await service.validate(nested(60), { maxDepth: 64 })).ok).toBe(true);
  expect((await service.validate(nested(61), { maxDepth: 64 })).errors).toContain(
    "HTML is nested more than 64 levels deep.",
  );
  expect((await service.validate(nested(61))).ok).toBe(true);
  expect((await service.validate(`<template>${nested(70)}</template>`, { maxDepth: 64 })).ok).toBe(
    false,
  );
  for (const n of [60, 61]) {
    expect((await service.validate(nested(n), { maxDepth: 64 })).ok).toBe(
      parse5Validate(nested(n), { maxDepth: 64 }).ok,
    );
  }
  expect(() => parse5Validate("<p>x</p>", { maxDepth: 0 })).toThrow("maxDepth");
});
