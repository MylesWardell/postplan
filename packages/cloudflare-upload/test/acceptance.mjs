import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const root = resolve(import.meta.dirname, "..");
async function bundle(entry, name) {
  let wasm;
  const out = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
    write: false,
    external: ["cloudflare:workers", "node:*"],
    plugins: [
      {
        name: "wasm",
        setup(b) {
          b.onResolve({ filter: /\.wasm$/ }, (args) => {
            wasm = readFileSync(resolve(args.resolveDir, args.path));
            return { path: "./module.wasm", external: true };
          });
        },
      },
    ],
  });
  return [
    {
      type: "ESModule",
      path: root + `/generated/${name}/index.js`,
      contents: out.outputFiles[0].text,
    },
    ...(wasm
      ? [{ type: "CompiledWasm", path: root + `/generated/${name}/module.wasm`, contents: wasm }]
      : []),
  ];
}
const common = {
  compatibilityDate: "2026-09-18",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    UPLOAD_ENABLED: "true",
    TEST_ACCOUNT_ID: "test",
    POSTPLAN_PUBLIC_BASE_URL: "https://example.com",
    POSTPLAN_RATE_LIMIT_SECRET: "local-test-secret",
  },
  serviceBindings: { HTML_VALIDATOR: "validator" },
  d1Databases: { POSTPLAN_DB: "shared-db" },
  r2Buckets: { HTML_BUCKET: "shared-r2" },
  durableObjects: { RATE_LIMITS: { className: "RateLimit", scriptName: "limiter" } },
};
const variants = await Promise.all(
  [
    ["bare", "src/bare.ts"],
    ["hono", "src/worker.ts"],
    ["orpc", "src/orpc.ts"],
  ].map(async ([name, entry]) => ({ ...common, name, modules: await bundle(entry, name) })),
);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      ...variants,
      {
        name: "validator",
        compatibilityDate: "2026-09-18",
        compatibilityFlags: ["nodejs_compat"],
        modules: await bundle("../html-validator/src/worker.ts", "validator"),
      },
      {
        name: "limiter",
        compatibilityDate: "2026-09-18",
        compatibilityFlags: ["nodejs_compat"],
        modules: await bundle("../cloudflare/src/rate-limit.ts", "limiter"),
        durableObjects: { RATE_LIMITS: { className: "RateLimit", useSQLite: true } },
      },
    ],
  }),
);
try {
  await mf.ready;
  const db = await mf.getD1Database("POSTPLAN_DB", "hono");
  for (const [path, separator] of [
    ["../store-drizzle/drizzle/0000_same_vulcan.sql", "--> statement-breakpoint"],
    ["../cloudflare/deploy/schema.sql", ";"],
  ]) {
    await db.batch(
      readFileSync(resolve(root, path), "utf8")
        .split(separator)
        .filter((s) => s.trim())
        .map((s) => db.prepare(s)),
    );
  }
  await db.prepare("INSERT INTO usage_guard VALUES(1,0)").run();
  await db.prepare("INSERT INTO accounts(id,name) VALUES('test','Test'),('other','Other')").run();
  let token;
  const html =
    '<!doctype html><title>Test title</title><p>Hello</p><img src="https://EXAMPLE.com/a"><script>console.log(1)</script>';
  let count = 0;
  for (const arm of ["bare", "hono", "orpc"]) {
    token = "local-token-" + arm;
    await db
      .prepare("INSERT INTO api_keys(id,account_id,name,key_hash) VALUES(?,?,?,?)")
      .bind("key-" + arm, "test", arm, createHash("sha256").update(token).digest("hex"))
      .run();
    const worker = await mf.getWorker(arm);
    const send = async (body, expected = 201, headers = {}) => {
      const r = await worker.fetch("https://example.com/api/uploads", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          "cf-connecting-ip": arm,
          "cf-ray": "local-" + arm,
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      const text = await r.text();
      assert.equal(r.status, expected, `${arm}: ${text}`);
      count++;
      return JSON.parse(text);
    };
    const result = await send({
      html,
      description: " Description ",
      metadata: { repoName: "Repo", gitDirty: true },
    });
    assert.equal(result.title, "Test title");
    const row = await db
      .prepare("SELECT * FROM draft_versions WHERE id=?")
      .bind(result.versionId)
      .first();
    assert.equal(row.file_size, Buffer.byteLength(html));
    assert.equal(row.content_hash, createHash("sha256").update(html).digest("hex"));
    assert.equal(row.has_inline_script, 1);
    assert.deepEqual(JSON.parse(row.external_image_hosts), ["example.com"]);
    const bucket = await mf.getR2Bucket("HTML_BUCKET", "hono");
    assert.equal(await (await bucket.get(row.object_key)).text(), html);
    const updates = await Promise.all([
      send({ html, draftId: result.draftId }, 200),
      send({ html, draftId: result.draftId }, 200),
    ]);
    assert.deepEqual(
      updates.map((x) => x.versionNumber).sort((a, b) => a - b),
      [2, 3],
    );
    await send({ html, draftId: null });
    assert.equal(
      (await worker.fetch("https://example.com/api/uploads", { method: "GET" })).status,
      404,
    );
    assert.equal((await worker.fetch("https://example.com/other")).status, 404);
    const before = await db.prepare("SELECT writes FROM application_budget").first("writes");
    await send({ html, metadata: { padding: "a".repeat(2 * 1024 * 1024) } }, 413);
    await send({ html: '<iframe src="https://example.com"></iframe>' }, 422);
    await send({ html: "<div>".repeat(64) + "x" + "</div>".repeat(64) }, 422);
    await send({ html: "a".repeat(32769) }, 422);
    await send({ html, draftId: "missing00000" }, 404);
    await db
      .prepare(
        "INSERT OR IGNORE INTO drafts(id,account_id,title) VALUES('foreign00000','other','Private')",
      )
      .run();
    await send({ html, draftId: "foreign00000" }, 404);
    await send({ html }, 401, { authorization: "Bearer wrong" });
    await send("{", 400);
    await send({ html, filename: 123 }, 400);
    assert.equal(await db.prepare("SELECT writes FROM application_budget").first("writes"), before);
    await db.prepare("UPDATE usage_guard SET killed=1").run();
    await send({ html }, 503);
    await db.prepare("UPDATE usage_guard SET killed=0").run();
    await db.prepare("UPDATE api_keys SET revoked_at=1").run();
    await send({ html }, 401);
    await db.prepare("UPDATE api_keys SET revoked_at=NULL").run();
    await db.prepare("UPDATE application_budget SET writes=2000").run();
    await send({ html }, 429);
    await db.prepare("UPDATE application_budget SET writes=?").bind(before).run();
    const draftsBefore = await db.prepare("SELECT count(*) AS n FROM drafts").first("n");
    await db
      .prepare(
        "CREATE TRIGGER fail_event BEFORE INSERT ON upload_events BEGIN SELECT RAISE(ABORT,'injected atomic failure'); END",
      )
      .run();
    await send({ html }, 500);
    await db.prepare("DROP TRIGGER fail_event").run();
    assert.equal(await db.prepare("SELECT count(*) AS n FROM drafts").first("n"), draftsBefore);
    assert.equal(
      await db.prepare("SELECT writes FROM application_budget").first("writes"),
      before + 1,
    );
    console.log(arm, "budget refusal, atomic rollback, non-refunded failed write passed");
    console.log(
      arm,
      "create, concurrent versions, exact R2 bytes, metadata, rejected input, revoked key, kill switch passed",
    );
  }
  const worker = await mf.getWorker("orpc");
  const before = await db.prepare("SELECT writes FROM application_budget").first("writes");
  let blocked = false;
  for (let i = 0; i < 31; i++) {
    const r = await worker.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "cf-connecting-ip": "rate-only" },
      body: JSON.stringify({ html: "<iframe>" }),
    });
    assert.ok([422, 429].includes(r.status));
    if (r.status === 429) {
      blocked = true;
      break;
    }
  }
  assert.ok(blocked);
  assert.equal(await db.prepare("SELECT writes FROM application_budget").first("writes"), before);
  console.log(`${count} acceptance requests checked; real DO key quota enforced`);
} finally {
  await mf.dispose();
}
