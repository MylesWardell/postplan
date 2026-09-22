// CPU benchmark entry. `run.sh` copies this file over worker.ts in a disposable repository copy.
// It is type-checked here beside the production modules it imports. Never deploy it.
//
// A Durable Object runs the real built application in a loop against a D1-compatible adapter
// over its own SQLite storage and an in-memory R2 bucket. With no bindings on the hot path, the
// profiled isolate contains only application work plus native SQLite calls.
import "./instrumentation";

import { createHash, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

import { DurableObject } from "cloudflare:workers";

import { createApplication } from "@postplan/web/application";
import { renderFrontend } from "@postplan/web/astro-render";

import migration from "../../store-drizzle/drizzle/0000_same_vulcan.sql?raw";
import budgetSchema from "../deploy/schema.sql?raw";
import { applicationStorage } from "./application-storage";
import { createCloudflareStore } from "./database";
import { handleCloudflareRequest } from "./request-pipeline";

type Value = string | number | null | ArrayBuffer;
type Statement = {
  bind(...params: unknown[]): Statement;
  execSync(): Record<string, SqlStorageValue>[];
};

let transaction: <T>(fn: () => T) => T;

function fakeD1(sql: SqlStorage): D1Database {
  const normalize = (params: unknown[]) =>
    params.map((p) => (typeof p === "boolean" ? Number(p) : p === undefined ? null : p)) as Value[];
  const statement = (query: string, params: Value[] = []) => ({
    bind: (...next: unknown[]) => statement(query, normalize(next)),
    async all() {
      const cursor = sql.exec(query, ...params);
      return { results: cursor.toArray(), success: true, meta: { changes: cursor.rowsWritten } };
    },
    async raw() {
      return [...sql.exec(query, ...params).raw()];
    },
    async run() {
      const cursor = sql.exec(query, ...params);
      cursor.toArray();
      return { results: [], success: true, meta: { changes: cursor.rowsWritten } };
    },
    async first(column?: string) {
      const row = sql.exec(query, ...params).toArray()[0];
      return row === undefined ? null : column ? row[column] : row;
    },
    execSync: () => sql.exec(query, ...params).toArray(),
  });
  return {
    prepare: (query: string) => statement(query),
    async batch(statements: Statement[]) {
      return transaction(() =>
        statements.map((s) => ({ results: s.execSync(), success: true, meta: {} })),
      );
    },
  } as unknown as D1Database;
}

function fakeR2(): R2Bucket {
  const objects = new Map<string, string>();
  return {
    async put(key: string, value: string) {
      objects.set(key, value);
    },
    async get(key: string) {
      const value = objects.get(key);
      return value === undefined
        ? null
        : {
            size: Buffer.byteLength(value),
            body: new Response(value).body!,
            text: async () => value,
          };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

const token = "local-benchmark-key";
const base = "http://localhost:5173";
const payload = Buffer.from(
  JSON.stringify({ accountId: "acct_bootstrap", accountName: "Owner", exp: 4102444800 }),
).toString("base64url");
const session = `postplan_session=${payload}.${createHmac("sha256", "local-session-only").update(payload).digest("base64url")}`;
const html = (size: number) => {
  const head = "<!doctype html><html><head><title>Synthetic CPU plan</title></head><body>";
  const piece = "<p>Synthetic review paragraph for bounded CPU testing.</p>";
  const body = head + piece.repeat(Math.floor((size - head.length - 14) / piece.length));
  return body + " ".repeat(size - body.length - 14) + "</body></html>";
};
const small = JSON.stringify({ html: html(5356) });
const large = JSON.stringify({ html: html(512 * 1024 - 64) });
let draftId = "";
let plans = 58;
// Prepare compression once, outside the profiled request loop.
const compressedLarge = gzipSync(large);
const compressedMalformed = gzipSync(" ".repeat(512 * 1024) + "{");
const upload = (body: string | Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}) =>
  new Request(base + "/api/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra },
    body,
  });

// Keep names in sync with PLAN in profile.ts.
const cases: Record<string, () => Request> = {
  healthz: () => new Request(base + "/healthz"),
  home: () => new Request(base + "/"),
  dashboard: () => new Request(base + "/dashboard", { headers: { cookie: session } }),
  list: () => new Request(base + "/api/drafts", { headers: { authorization: `Bearer ${token}` } }),
  listMax: () =>
    new Request(base + "/api/drafts?limit=100", { headers: { authorization: `Bearer ${token}` } }),
  public: () => new Request(base + "/d/" + draftId),
  upload: () => upload(small),
  uploadLarge: () => upload(large),
  uploadGzip: () => upload(compressedLarge, { "content-encoding": "gzip" }),
  uploadMalformed: () => upload("{"),
  uploadMalformedGzip: () => upload(compressedMalformed, { "content-encoding": "gzip" }),
  uploadInvalidGzip: () => upload("invalid gzip", { "content-encoding": "gzip" }),
  uploadUnauthorized: () =>
    upload(compressedLarge, { authorization: "", "content-encoding": "gzip" }),
  uploadIpLimited: () => upload(compressedLarge, { "content-encoding": "gzip" }),
  uploadKeyLimited: () => upload(compressedLarge, { "content-encoding": "gzip" }),
};

// Exported under the existing SQLite Durable Object class name so wrangler.jsonc needs no changes.
export class RateLimit extends DurableObject {
  handle?: (request: Request) => Promise<Response>;
  private deniedNamespace: string | undefined;

  setup() {
    const sql = this.ctx.storage.sql;
    transaction = (fn) => this.ctx.storage.transactionSync(fn);
    if (!sql.exec("SELECT name FROM sqlite_master WHERE name='drafts'").toArray().length) {
      for (const part of migration.split("--> statement-breakpoint")) {
        sql.exec(part);
      }
      sql.exec(budgetSchema);
      sql.exec(
        "INSERT OR IGNORE INTO accounts(id,name) VALUES ('acct_bootstrap','Bootstrap Account')",
      );
      sql.exec(
        "INSERT OR IGNORE INTO api_keys(id,account_id,name,key_hash) VALUES ('key_bootstrap','acct_bootstrap','Bootstrap Account',?)",
        createHash("sha256").update(token).digest("hex"),
      );
    }
    const db = fakeD1(sql);
    const bucket = fakeR2();
    let activeNamespace: string | undefined;
    const env = {
      POSTPLAN_APPLICATION_ENABLED: "true",
      POSTPLAN_PUBLIC_BASE_URL: base,
      POSTPLAN_LOCAL: "true",
      POSTPLAN_DB: db,
      HTML_BUCKET: bucket,
      POSTPLAN_DATABASE: "sqlite",
      POSTPLAN_RATE_LIMIT_SECRET: "local-benchmark-only",
      RATE_LIMITS: {
        getByName: () => ({
          limit: async (rule: { maxRequests: number }) => ({
            success: activeNamespace !== this.deniedNamespace || this.deniedNamespace === undefined,
            limit: rule.maxRequests,
            remaining: activeNamespace === this.deniedNamespace ? 0 : rule.maxRequests,
            reset: Date.now() + 60000,
          }),
        }),
      },
      ASSETS: { fetch: () => new Response("Not found", { status: 404 }) },
    } as unknown as Cloudflare.Env;
    const store = createCloudflareStore(env).store;
    const application = createApplication(
      {
        store: {
          ...store,
          rateLimit: (input) => {
            activeNamespace = input.namespace;
            return store.rateLimit(input);
          },
        },
        ...applicationStorage(db, bucket),
      },
      { compressResponse: false, enableEvlog: false, renderFrontend },
    );
    return (incoming: Request) => handleCloudflareRequest(incoming, env, application);
  }

  override async fetch(request: Request) {
    this.handle ??= this.setup();
    const sql = this.ctx.storage.sql;
    const url = new URL(request.url);
    if (url.pathname === "/seed") {
      const count = sql
        .exec("SELECT count(*) AS n FROM drafts WHERE account_id='acct_bootstrap'")
        .one().n as number;
      plans = Number(url.searchParams.get("plans") || plans);
      for (let i = count; i < plans; i++) {
        const response = await this.handle(cases.upload!());
        if (response.status !== 201) {
          throw new Error(await response.text());
        }
      }
      draftId = sql
        .exec("SELECT id FROM drafts WHERE account_id='acct_bootstrap' ORDER BY created_at LIMIT 1")
        .one().id as string;
      return new Response("seeded " + draftId);
    }
    const name = url.searchParams.get("case") ?? "";
    const build = cases[name];
    if (!build) {
      return new Response("Unknown case", { status: 404 });
    }
    const n = Number(url.searchParams.get("n") || 100);
    const status: Record<number, number> = {};
    let bytes = 0;
    let sample = "";
    // Deterministic denials exercise the real admission path and limiter-name hashing,
    // without measuring remote Durable Object latency or persistent limiter writes.
    this.deniedNamespace =
      name === "uploadIpLimited"
        ? "upload-ip"
        : name === "uploadKeyLimited"
          ? "upload-key"
          : undefined;
    for (let i = 0; i < n; i++) {
      const response = await this.handle(build());
      status[response.status] = (status[response.status] || 0) + 1;
      const text = await response.text();
      bytes = text.length;
      if (response.status >= 400) {
        sample = text.slice(0, 200);
      }
    }
    this.deniedNamespace = undefined;
    if (name.startsWith("upload")) {
      // Keep the seeded plan dataset stable for later cases and runs.
      const keep = `SELECT id FROM drafts ORDER BY created_at, id LIMIT ${plans}`;
      sql.exec(`DELETE FROM upload_events WHERE draft_id NOT IN (${keep})`);
      sql.exec(`DELETE FROM draft_versions WHERE draft_id NOT IN (${keep})`);
      sql.exec(`DELETE FROM drafts WHERE id NOT IN (${keep})`);
    }
    return Response.json({ status, bytes, sample });
  }
}

export default {
  fetch(request, env) {
    return env.RATE_LIMITS.getByName("bench").fetch(request);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
