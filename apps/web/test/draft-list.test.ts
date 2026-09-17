import { createTestStore } from "@postplan/store/testing";
import assert from "node:assert/strict";
import { test } from "vitest";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { contract, type ApiClient } from "@postplan/api";
import { createServerOptions } from "./start-server";
import { config } from "#config";
import { createSessionCookie } from "#auth/session";

async function upload(api: ApiClient, title: string, repoName?: string) {
  const { body } = await api.drafts.upload({
    html: `<!doctype html><title>${title}</title><p>Body</p>`,
    metadata: repoName ? { repoName } : {},
  });
  assert.ok(body.ok);
  return body.draftId;
}
const draftLinks = (html: string) =>
  [...html.matchAll(/href="\/dashboard\/drafts\/([a-z0-9]+)\/"/g)].map((match) => match[1]);
const byText = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");

test("draft lists are bounded keyset pages with owner-scoped filters and totals", async () => {
  const { store, close } = await createTestStore();
  const objects = new Map<string, string>();
  const originalConfig = { ...config };
  await store.accounts.seed({ bootstrapKey: "owner-key" });
  const otherAccount = await store.accounts.findOrCreateIdentity({
    provider: "test",
    subject: "other-list",
    profile: { displayName: "Other" },
  });
  const otherKey = await store.accounts.createApiKey({
    accountId: otherAccount.accountId,
    name: "other-key",
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...createServerOptions({
      store,
      putHtml: async (key, html) => void objects.set(key, html),
      getHtml: async (key) => objects.get(key) ?? "",
    }),
  });
  try {
    const base = server.url.origin;
    config.publicBaseUrl = base;
    config.sessionSecret = "test-session-secret";
    const client = (token: string) =>
      createORPCClient<ApiClient>(
        new OpenAPILink(contract, {
          origin: base,
          url: "/api",
          headers: { authorization: `Bearer ${token}` },
        }),
      );
    const owner = client("owner-key");
    const other = client(otherKey.token);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(await upload(owner, `Plan ${i}`, i === 3 ? "Roadmap-Repo" : undefined));
    }
    await owner.drafts.upload({ html: "<!doctype html><title>Plan 1</title>", draftId: ids[1] });
    await owner.drafts.disable({ draftId: ids[2]! });
    await owner.drafts.disable({ draftId: ids[5]! });
    await owner.drafts.delete({ draftId: ids[6]! });
    await upload(other, "Plan other");

    const all = await owner.drafts.list();
    assert.equal(all.nextCursor, null);
    assert.equal(all.drafts.length, 6);
    const order = all.drafts.map(
      (draft) => [new Date(draft.updatedAt).getTime(), draft.draftId] as const,
    );
    assert.deepEqual(
      order,
      order.toSorted((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)),
    );

    const paged: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await owner.drafts.list({ limit: 4, cursor });
      assert.ok(page.drafts.length <= 4);
      paged.push(...page.drafts.map((draft) => draft.draftId));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    assert.equal(pages, 2);
    assert.deepEqual(
      paged,
      all.drafts.map((draft) => draft.draftId),
    );

    const disabled = await owner.drafts.list({ status: "disabled", limit: 1 });
    assert.equal(disabled.drafts.length, 1);
    assert.ok(disabled.nextCursor);
    const lastDisabled = await owner.drafts.list({
      status: "disabled",
      limit: 1,
      cursor: disabled.nextCursor,
    });
    assert.deepEqual(
      [disabled.drafts[0]?.draftId, lastDisabled.drafts[0]?.draftId].toSorted(byText),
      [ids[2], ids[5]].toSorted(byText),
    );
    assert.equal(lastDisabled.nextCursor, null);
    assert.equal((await owner.drafts.list({ status: "published" })).drafts.length, 4);
    assert.deepEqual(
      (await owner.drafts.list({ q: "ROADMAP-repo" })).drafts.map((draft) => draft.draftId),
      [ids[3]],
    );
    assert.equal((await owner.drafts.list({ q: "plan other" })).drafts.length, 0);
    assert.deepEqual(await owner.drafts.totals(), { drafts: 6, published: 4, versions: 7 });
    assert.deepEqual(await other.drafts.totals(), { drafts: 1, published: 1, versions: 1 });

    const rest = (path: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/api${path}`, { headers: { authorization: "Bearer owner-key", ...headers } });
    const restPage = await rest("/drafts?limit=2&status=all");
    assert.equal(restPage.status, 200);
    const restBody = (await restPage.json()) as { drafts: unknown[]; nextCursor: string };
    assert.equal(restBody.drafts.length, 2);
    assert.equal(typeof restBody.nextCursor, "string");
    assert.equal((await rest("/drafts?limit=101")).status, 400);
    assert.equal((await rest("/drafts?limit=0")).status, 400);
    assert.equal((await rest("/drafts?cursor=not-a-cursor")).status, 400);
    assert.equal((await rest("/drafts?status=deleted")).status, 400);
    const totals = await rest("/drafts/totals");
    assert.equal(totals.status, 200);
    assert.deepEqual(await totals.json(), { drafts: 6, published: 4, versions: 7 });

    const cookie = createSessionCookie({
      accountId: "acct_bootstrap",
      accountName: "Bootstrap Account",
      email: null,
      pictureUrl: null,
    }).split(";")[0]!;
    const page = (path: string) =>
      fetch(`${base}${path}`, { headers: { cookie } }).then((response) => response.text());
    const dashboard = await page("/dashboard");
    assert.match(dashboard, /Total drafts<\/span><strong>6</);
    assert.match(dashboard, /Saved versions<\/span><strong>7</);
    assert.doesNotMatch(dashboard, /Next page/);
    assert.doesNotMatch(dashboard, new RegExp(`/d/${ids[0]}`));
    assert.match(await page("/dashboard?q=roadmap-REPO"), /Plan 3/);
    assert.match(await page("/dashboard?status=disabled"), /Plan 5/);
    assert.doesNotMatch(await page("/dashboard?status=disabled"), /Plan 4/);
    assert.match(await page("/dashboard?cursor=invalid"), /Plan 4/);

    for (let i = 0; i < 20; i++) {
      const result = await store.drafts.upload({
        context: {
          apiKey: {
            id: "key_bootstrap",
            name: "Bootstrap API Key",
            accountId: "acct_bootstrap",
            accountName: "Bootstrap Account",
          },
          publicBaseUrl: base,
          requestBaseUrl: base,
          sourceIp: null,
          userAgent: null,
          requestId: null,
          maxHtmlBytes: 512 * 1024,
          putHtml: async (key, html) => void objects.set(key, html),
        },
        input: { html: `<!doctype html><title>Bulk ${i}</title>` },
      });
      assert.ok(result.ok);
    }
    const first = await page("/dashboard");
    assert.match(first, /Total drafts<\/span><strong>26</);
    assert.equal(new Set(draftLinks(first)).size, 25);
    const next = first.match(/href="(\/dashboard\?cursor=[^"]+)">Next page/)?.[1];
    assert.ok(next);
    const second = await page(next.replaceAll("&amp;", "&"));
    assert.match(second, /First page/);
    assert.doesNotMatch(second, /Next page/);
    assert.equal(new Set([...draftLinks(first), ...draftLinks(second)]).size, 26);
  } finally {
    Object.assign(config, originalConfig);
    await server.stop(true);
    await close();
  }
}, 30_000);
