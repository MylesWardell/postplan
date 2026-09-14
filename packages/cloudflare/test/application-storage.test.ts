import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { applicationStorage } from "../src/application-storage";
import { boundedBody } from "../src/body";
import schema from "../deploy/schema.sql?raw";

beforeEach(async () => {
  await env.POSTPLAN_DB.batch(
    schema
      .split(";")
      .filter((s) => s.trim() && !s.includes("CREATE INDEX"))
      .map((s) => env.POSTPLAN_DB.prepare(s)),
  );
});
afterEach(() => reset());

test("concurrent writes cannot cross lifetime capacity and exhausted reads never touch R2", async () => {
  const storage = applicationStorage(env.POSTPLAN_DB, env.HTML_BUCKET);
  await env.POSTPLAN_DB.exec("UPDATE application_budget SET writes=1999");
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) => storage.putHtml(`test-${i}`, "<p>test</p>")),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await env.HTML_BUCKET.list()).objects).toHaveLength(1);
  await env.POSTPLAN_DB.batch(
    schema
      .split(";")
      .filter((s) => s.trim() && !s.includes("CREATE INDEX"))
      .map((s) => env.POSTPLAN_DB.prepare(s)),
  );
  expect(
    await env.POSTPLAN_DB.prepare("SELECT writes FROM application_budget").first("writes"),
  ).toBe(2000);
  await env.POSTPLAN_DB.exec("UPDATE application_budget SET reads=250000");
  await expect(storage.getHtml("missing")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

test("stop latch blocks both storage directions, and oversized UTF-8 does not reserve", async () => {
  const storage = applicationStorage(env.POSTPLAN_DB, env.HTML_BUCKET);
  await expect(storage.putHtml("big", "Ã©".repeat(262145))).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
  });
  expect(
    await env.POSTPLAN_DB.prepare("SELECT writes FROM application_budget").first("writes"),
  ).toBe(0);
  await env.POSTPLAN_DB.exec("INSERT INTO usage_guard VALUES (1,1)");
  await expect(storage.putHtml("small", "x")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  await expect(storage.getHtml("small")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect((await env.HTML_BUCKET.list()).objects).toHaveLength(0);
});

test("bounded bodies enforce actual bytes rather than Content-Length", async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    headers: { "content-length": "1" },
    body: "123456",
  });
  expect(await boundedBody(request, 5)).toBeNull();
  expect(
    new TextDecoder().decode(
      (await boundedBody(
        new Request("https://example.com", { method: "POST", body: "12345" }),
        5,
      ))!,
    ),
  ).toBe("12345");
});
