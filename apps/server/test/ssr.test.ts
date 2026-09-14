import { createDatabase } from "../src/db/client.js";
import { boundedRequest } from "../src/http/body.js";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { accounts } from "../src/db/schema.js";
import { seedAccounts } from "../src/routers/account-store.js";
import { createServerOptions } from "../src/index.js";
import { config } from "../src/config.js";
import { createAuthStateCookie, createSessionCookie } from "../src/auth/session.js";

// Exercise rendered pages and native forms against SQLite, without S3 or OAuth calls.
test("SSR dashboard forms preserve ownership, escape content, and manage drafts and keys", async () => {
  const { db, client: sqlite } = createDatabase(":memory:");
  let server: ReturnType<typeof Bun.serve> | undefined;
  const original = { ...config };
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedAccounts(db, "ssr-owner-key");
    await db.insert(accounts).values({ id: "visitor", name: "Visitor" });
    config.publicBaseUrl = "https://*.plans.example.com";
    config.sessionSecret = "ssr-test-secret";
    const objects = new Map<string, string>();
    const options = createServerOptions({
      db,
      putHtml: async (key, html) => {
        objects.set(key, html);
      },
      getHtml: async (key) => objects.get(key)!,
    });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, ...options });
    const local = server.url.origin;
    const app = async (request: Request) => {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.set("host", url.host);
      return fetch(local + url.pathname + url.search, {
        method: request.method,
        headers,
        redirect: "manual",
        ...(request.body ? { body: await request.arrayBuffer() } : {}),
      });
    };
    const base = "https://plans.example.com";
    const cookie = createSessionCookie({ accountId: "acct_bootstrap", accountName: "Owner" }).split(
      ";",
    )[0]!;
    const otherCookie = createSessionCookie({ accountId: "visitor", accountName: "Visitor" }).split(
      ";",
    )[0]!;
    const get = (path: string, sessionCookie = cookie) =>
      app(new Request(base + path, { headers: { cookie: sessionCookie } }));
    const post = (
      path: string,
      fields: Record<string, string> = {},
      origin = base,
      sessionCookie = cookie,
    ) =>
      app(
        new Request(base + path, {
          method: "POST",
          headers: { cookie: sessionCookie, origin },
          body: new URLSearchParams(fields),
        }),
      );
    const api = (path: string, method: string, body?: unknown) =>
      app(
        new Request(base + path, {
          method,
          headers: { authorization: "Bearer ssr-owner-key", "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    const docs = await get("/api");
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /scalar/i);
    const specResponse = await get("/api/spec.json");
    assert.equal(specResponse.status, 200);
    const spec = (await specResponse.json()) as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, unknown>; security?: unknown }>
      >;
    };
    assert.ok(spec.paths["/drafts/{draftId}"]?.patch);
    assert.ok(spec.paths["/uploads"]?.post?.responses["201"]);
    assert.ok(spec.paths["/uploads"]?.post?.responses["422"]);
    assert.ok(spec.paths["/me"]?.get?.security);
    const preflight = await app(
      new Request(base + "/api/drafts", {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,content-type,standard-server",
        },
      }),
    );
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/i);
    assert.match(await (await get("/dashboard", "")).text(), /Continue with Shoo/);
    assert.match(await (await get("/dashboard")).text(), /Your next idea starts here/);
    const html = "<!doctype html><title>Project roadmap</title><p>First version</p>";
    // Published CLI sends draftId:null for its first upload.
    const upload = await api("/api/uploads", "POST", {
      html,
      draftId: null,
      filename: "plan.html",
    });
    assert.equal(upload.status, 201);
    const { draftId, publicUrl } = (await upload.json()) as { draftId: string; publicUrl: string };
    const path = `/dashboard/drafts/${draftId}`;
    const dashboard = await get("/dashboard");
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.headers.get("content-security-policy")!, /form-action 'self'/);
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /Project roadmap/);
    assert.doesNotMatch(dashboardHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "", /&quot;/);
    assert.match(await (await get("/dashboard?q=absent")).text(), /No drafts match your filters/);
    assert.equal((await get(path, otherCookie)).status, 404);
    assert.equal(
      (await post(path + "/update", { title: "Stolen" }, base, otherCookie)).status,
      404,
    );
    assert.equal(
      (await post(path + "/update", { title: "Stolen" }, "https://evil.example")).status,
      403,
    );
    assert.equal((await post(path + "/update", { title: "Stolen" }, publicUrl)).status, 403);
    assert.equal((await post(path + "/update", { title: "" })).status, 400);
    const edited = await post(path + "/update", {
      title: '<script>alert("x")</script>',
      description: '<img src=x onerror="alert(1)">',
    });
    assert.equal(edited.status, 303);
    const detail = await (await get(path + "?saved=1")).text();
    assert.match(detail, /Your changes have been saved/);
    assert.match(detail, /&lt;script>/);
    assert.doesNotMatch(detail, /<script>alert/);
    assert.match(detail, /Version history/);
    assert.match(detail, /--draft /);
    assert.equal((await api(`/api/drafts/${draftId}`, "GET")).status, 200);
    assert.equal((await post(path + "/disable")).status, 303);
    assert.equal((await app(new Request(publicUrl))).status, 404);
    assert.equal((await get(`/d/${draftId}/v/1/raw`)).status, 404);
    assert.match(await (await get("/dashboard?status=published")).text(), /No drafts match/);
    assert.equal((await post(path + "/enable")).status, 303);
    assert.equal(await (await app(new Request(publicUrl))).text(), html);
    for (const forbidden of [
      "/dashboard",
      "/cli/auth",
      "/auth/sign-in",
      "/api/drafts",
      "/ws/rpc",
      "/api/spec.json",
    ]) {
      assert.equal(
        (await app(new Request(publicUrl + forbidden, { headers: { cookie } }))).status,
        404,
      );
    }
    const badHtml = await api("/api/uploads", "POST", { html: "<form></form>" });
    assert.equal(badHtml.status, 422);
    const rejection = (await badHtml.json()) as {
      code: string;
      message: string;
      data: { errors: string[] };
    };
    assert.equal(rejection.code, "UNPROCESSABLE_CONTENT");
    assert.equal(rejection.message, "HTML validation failed.");
    assert.ok(rejection.data.errors.length);
    const malformed = await app(
      new Request(base + "/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    assert.equal(malformed.status, 400);
    await assert.rejects(
      boundedRequest(
        new Request(base + "/api/uploads", {
          method: "POST",
          body: "x".repeat(2 * 1024 * 1024 + 1),
        }),
      ),
      { code: "PAYLOAD_TOO_LARGE" },
    );
    const minted = await post("/cli/auth/keys", { name: "Work laptop" });
    assert.equal(minted.status, 200);
    const keyPage = await minted.text();
    const token = keyPage.match(/pp_[a-f0-9]{64}/)?.[0];
    assert.ok(token);
    assert.doesNotMatch(await (await get("/cli/auth")).text(), new RegExp(token));
    const keys = (await (await api("/api/api-keys", "GET")).json()) as {
      id: string;
      name: string;
    }[];
    const keyId = keys.find((key) => key.name === "Work laptop")!.id;
    assert.equal((await post(`/cli/auth/keys/${keyId}/revoke`, {}, base, otherCookie)).status, 404);
    assert.equal((await post(`/cli/auth/keys/${keyId}/revoke`)).status, 303);
    assert.equal(
      (await app(new Request(base + "/api/me", { headers: { authorization: `Bearer ${token}` } })))
        .status,
      401,
    );
    assert.equal((await post(path + "/delete", { confirmation: "no" })).status, 400);
    assert.equal((await post(path + "/delete", { confirmation: "DELETE" })).status, 303);
    assert.equal((await get(path)).status, 404);
    assert.equal((await app(new Request(publicUrl))).status, 404);
    const signIn = await get("/auth/sign-in?next=https://evil.example");
    assert.equal(signIn.status, 303);
    assert.match(signIn.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(
      new URL(signIn.headers.get("location")!).searchParams.get("redirect_uri"),
      base + "/auth/callback",
    );
    const authCookie = createAuthStateCookie({
      state: "expected",
      verifier: "verifier",
      next: "/dashboard",
    }).split(";")[0]!;
    const callback = await get("/auth/callback?state=wrong&code=bad", authCookie);
    assert.equal(callback.status, 400);
    assert.match(callback.headers.get("set-cookie")!, /Max-Age=0/);
    const signOut = await post("/auth/sign-out");
    assert.equal(signOut.status, 303);
    assert.match(signOut.headers.get("set-cookie")!, /Max-Age=0/);
  } finally {
    Object.assign(config, original);
    await server?.stop(true);
    sqlite.close();
  }
}, 30_000);
