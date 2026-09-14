import { testDatabase } from "./database-fixture";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { seedAccounts } from "#routers/account-store";
import { createServerOptions } from "./start-server";
import { config } from "#config";
import {
  createAuthStateCookie,
  createSessionCookie,
  readAuthState,
  readSession,
} from "#auth/session";
import { resetShooCaches } from "#auth/shoo";

// Exercise rendered pages, native forms, and local Shoo callbacks without external services.
test("SSR dashboard forms preserve ownership, escape content, and manage drafts and keys", async () => {
  const { db, close, createAccount } = await testDatabase();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let shoo: ReturnType<typeof Bun.serve> | undefined;
  const original = { ...config };
  try {
    await seedAccounts(db, "ssr-owner-key");
    await createAccount("visitor", "Visitor");
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
    const specResponse = await app(
      new Request(base + "/api/spec.json", { headers: { "accept-encoding": "gzip" } }),
    );
    assert.equal(specResponse.headers.get("content-encoding"), "gzip");
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
    assert.match(
      await (await get("/dashboard?q=roadmap&status=published", "")).text(),
      /next=%2Fdashboard%3Fq%3Droadmap%26status%3Dpublished/,
    );
    assert.match(await (await get("/", "")).text(), /Good work deserves/);
    for (const path of ["/missing", "/dashboard/missing", "/cli/auth/missing"]) {
      assert.equal((await get(path)).status, 404);
      assert.equal((await get(path, "")).status, 404);
    }
    assert.match(await (await get("/dashboard")).text(), /Your next idea starts here/);
    const html = "<!doctype html><title>Project roadmap</title><p>First version</p>";
    // Published CLI sends draftId:null for its first upload.
    const upload = await app(
      new Request(base + "/api/uploads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          authorization: "Bearer ssr-owner-key",
          [config.requestIdHeader]: "compression-test",
        },
        body: gzipSync(JSON.stringify({ html, draftId: null, filename: "plan.html" })),
      }),
    );
    assert.equal(upload.headers.get("x-request-id"), "compression-test");
    assert.equal(upload.status, 201);
    const { draftId, publicUrl } = (await upload.json()) as { draftId: string; publicUrl: string };
    const path = `/dashboard/drafts/${draftId}`;
    const dashboard = await get("/dashboard");
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.headers.get("content-security-policy")!, /form-action 'self'/);
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /<link rel="stylesheet" href="\/assets\/styles.css"[^>]*>/);
    assert.doesNotMatch(dashboardHtml, /<style[\s>]/);
    assert.match(dashboard.headers.get("content-security-policy")!, /style-src 'self'/);
    const stylesheet = await get("/assets/styles.css", "");
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type")!, /^text\/css/);
    const css = await stylesheet.text();
    assert.match(css, /:root\s*\{/);
    assert.match(css, /@media/);
    assert.doesNotMatch(css, /&quot;/);
    assert.equal((await post("/assets/styles.css")).status, 404);
    assert.equal((dashboardHtml.match(/<html\b/g) ?? []).length, 1);
    const nonce = dashboard.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    const scripts = [...dashboardHtml.matchAll(/<script\b[^>]*>/g)];
    assert.ok(scripts.length > 0);
    for (const [tag] of scripts) {
      assert.ok(tag.includes(`nonce="${nonce}"`), tag);
    }
    assert.match(dashboardHtml, /Project roadmap/);
    const concurrentPages = await Promise.all([
      get("/dashboard").then((response) => response.text()),
      get("/dashboard", otherCookie).then((response) => response.text()),
      get(path).then((response) => response.text()),
      get("/cli/auth").then((response) => response.text()),
    ]);
    assert.match(concurrentPages[0]!, /Project roadmap/);
    assert.doesNotMatch(concurrentPages[1]!, /Project roadmap/);
    assert.match(concurrentPages[1]!, /Your next idea starts here/);
    assert.match(concurrentPages[2]!, /Version history/);
    assert.match(concurrentPages[3]!, /Create a key/);
    const serverBundle = await Bun.file(
      new URL("../dist/server/server.js", import.meta.url),
    ).text();
    const functionId = serverBundle.match(
      /"([a-f0-9]+)":\s*\{\s*functionName: "loadDashboard_createServerFn_handler"/,
    )?.[1];
    assert.ok(functionId);
    const functionPath = `/_serverFn/${functionId}`;
    const loadInBrowser = (sessionCookie: string, site = "same-origin", origin = base) =>
      app(
        new Request(base + functionPath, {
          headers: {
            cookie: sessionCookie,
            "sec-fetch-site": site,
            origin,
            "x-tsr-serverFn": "true",
          },
        }),
      );
    const ownerData = await loadInBrowser(cookie);
    assert.equal(ownerData.status, 200);
    assert.equal(ownerData.headers.get("cache-control"), "no-store");
    assert.match(await ownerData.text(), /Project roadmap/);
    assert.doesNotMatch(await (await loadInBrowser(otherCookie)).text(), /Project roadmap/);
    assert.doesNotMatch(await (await loadInBrowser("")).text(), /Project roadmap/);
    assert.equal((await loadInBrowser(cookie, "cross-site", "https://evil.example")).status, 403);
    assert.equal(
      (
        await app(
          new Request(publicUrl + functionPath, {
            headers: { cookie, "sec-fetch-site": "same-origin", "x-tsr-serverFn": "true" },
          }),
        )
      ).status,
      404,
    );
    for (const [tag] of scripts) {
      const source = tag.match(/src="([^"]+)"/)?.[1];
      if (!source) {
        continue;
      }
      const asset = await get(source, "");
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type")!, /javascript/);
      assert.match(asset.headers.get("cache-control")!, /immutable/);
      assert.equal((await app(new Request(publicUrl + source))).status, 404);
    }
    assert.match(await (await get("/dashboard/")).text(), /Project roadmap/);
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
    for (const action of ["update", "disable", "enable", "delete"]) {
      assert.equal((await get(`${path}/${action}`)).status, 404);
      assert.equal((await get(`${path}/${action}`, "")).status, 404);
    }
    for (const page of ["/", "/dashboard", path, "/cli/auth"]) {
      assert.equal((await post(page)).status, 404);
      assert.equal((await post(page, {}, base, "")).status, 404);
    }
    const edited = await post(path + "/update", {
      title: '<script>alert("x")</script>',
      description: '<img src=x onerror="alert(1)">',
    });
    assert.equal(edited.status, 303);
    const detail = await (await get(path + "?saved=1")).text();
    assert.match(detail, /Your changes have been saved/);
    assert.match(detail, /&lt;script&gt;/);
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
      "/assets/styles.css",
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
    const oversized = await app(
      new Request(base + "/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: gzipSync(JSON.stringify({ html: "x".repeat(2 * 1024 * 1024 + 1) })),
      }),
    );
    assert.equal(oversized.status, 413);
    assert.equal(((await oversized.json()) as { code: string }).code, "PAYLOAD_TOO_LARGE");
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
    assert.equal(keys.filter((key) => key.name === "Work laptop").length, 1);
    assert.equal((await get("/cli/auth/keys")).status, 404);
    assert.equal((await get(`/cli/auth/keys/${keyId}/revoke`)).status, 404);
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
    const initialAuthState = readAuthState(
      new Request(base, {
        headers: { cookie: signIn.headers.get("set-cookie")! },
      }),
    );
    assert.equal(initialAuthState?.next, "/dashboard");
    assert.equal(
      new URL(signIn.headers.get("location")!).searchParams.get("state"),
      initialAuthState?.state,
    );
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
    const cancelled = await get("/auth/callback?error=access_denied", authCookie);
    assert.equal(cancelled.status, 403);
    assert.match(cancelled.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await get("/auth/callback?state=expected", authCookie)).status, 400);

    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256" };
    let exchanges = 0;
    shoo = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const requestPath = new URL(req.url).pathname;
        if (requestPath === "/.well-known/openid-configuration") {
          return Response.json({ issuer: config.shooBaseUrl });
        }
        if (requestPath === "/.well-known/jwks.json") {
          return Response.json({ keys: [jwk] });
        }
        if (requestPath === "/token" && req.method === "POST") {
          exchanges++;
          const form = await req.formData();
          const code = form.get("code");
          assert.ok(code === "valid-code" || code === "denied-code");
          assert.equal(form.get("code_verifier"), "verifier");
          assert.equal(form.get("redirect_uri"), base + "/auth/callback");
          const allowed = code === "valid-code";
          const idToken = await new SignJWT({
            pairwise_sub: allowed ? "iso-user" : "denied-user",
            email: allowed ? "iso@example.com" : "intruder@elsewhere.test",
            email_verified: true,
          })
            .setProtectedHeader({ alg: "ES256", kid: "test-key" })
            .setIssuer(config.shooBaseUrl)
            .setAudience(`origin:${base}`)
            .setExpirationTime("5m")
            .sign(privateKey);
          return Response.json({ id_token: idToken });
        }
        return new Response(null, { status: 404 });
      },
    });
    config.shooBaseUrl = shoo.url.origin;
    config.allowedLoginDomains = ["example.com"];
    resetShooCaches();
    const denied = await get("/auth/callback?state=expected&code=denied-code", authCookie);
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /This email address is not permitted to sign in/);
    assert.doesNotMatch(denied.headers.get("set-cookie")!, /postplan_session=/);
    const completed = await get("/auth/callback?state=expected&code=valid-code", authCookie);
    assert.equal(completed.status, 303);
    assert.equal(completed.headers.get("location"), "/dashboard");
    assert.equal(exchanges, 2);
    assert.match(completed.headers.get("set-cookie")!, /postplan_auth_state=;[^,]*Max-Age=0/);
    const sessionCookie = completed.headers
      .getSetCookie()
      .find((value) => value.startsWith("postplan_session="))!;
    assert.equal(
      readSession(new Request(base, { headers: { cookie: sessionCookie } }))?.email,
      "iso@example.com",
    );
    assert.match(await (await get("/dashboard", sessionCookie)).text(), /iso@example.com/);
    assert.equal((await get("/auth/sign-out")).status, 404);
    assert.equal((await get("/auth/sign-out", "")).status, 404);
    assert.equal((await post("/auth/sign-in")).status, 404);
    assert.equal((await post("/auth/callback")).status, 404);
    const rejectedSignOut = await post("/auth/sign-out", {}, "https://evil.example");
    assert.equal(rejectedSignOut.status, 403);
    assert.equal(rejectedSignOut.headers.get("set-cookie"), null);
    const signOut = await post("/auth/sign-out");
    assert.equal(signOut.status, 303);
    assert.match(signOut.headers.get("set-cookie")!, /Max-Age=0/);
    config.sessionSecret = "";
    assert.equal((await get("/", "")).status, 200);
    assert.equal((await get("/dashboard", "")).status, 503);
    assert.equal((await get("/cli/auth", "")).status, 503);
    assert.equal((await get("/auth/sign-in", "")).status, 503);
    assert.equal((await get("/auth/callback", "")).status, 503);
    assert.equal((await post("/auth/sign-out")).status, 503);
    assert.equal((await get("/dashboard/missing", "")).status, 404);
  } finally {
    Object.assign(config, original);
    resetShooCaches();
    await shoo?.stop(true);
    await server?.stop(true);
    await close();
  }
}, 30_000);
