import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import type { ApiKeyAuth, IdentityInput, IdentityAccount } from "@postplan/store";

import { prepared, statement } from "./database";
import type { Database } from "./database";
import { accounts, apiKeys, identities } from "./schema";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function seedAccounts(db: Database, bootstrapKey?: string): Promise<void> {
  if (!bootstrapKey) {
    return;
  }
  await db.atomic([
    statement(
      db
        .insert(accounts)
        .values({ id: "acct_bootstrap", name: "Bootstrap Account" })
        .onConflictDoUpdate({ target: accounts.id, set: { updatedAt: new Date() } }),
    ),
    statement(
      db
        .insert(apiKeys)
        .values({
          id: "key_bootstrap",
          accountId: "acct_bootstrap",
          name: "Bootstrap API Key",
          keyHash: hash(bootstrapKey),
        })
        .onConflictDoUpdate({
          target: apiKeys.id,
          set: {
            keyHash: hash(bootstrapKey),
            name: "Bootstrap API Key",
            revokedAt: null,
          },
        }),
    ),
  ]);
}

const apiKeyByHashQuery = prepared((db) =>
  db
    .select({
      id: apiKeys.id,
      accountId: apiKeys.accountId,
      name: apiKeys.name,
      accountName: accounts.name,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
    .where(
      and(
        eq(apiKeys.keyHash, sql.placeholder("keyHash")),
        ne(apiKeys.id, "key_public_upload"),
        ne(apiKeys.accountId, "acct_public_upload"),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1)
    .prepare(),
);

const touchApiKeyQuery = prepared((db) =>
  db
    .update(apiKeys)
    .set({ lastUsedAt: sql`${sql.placeholder("now")}` })
    .where(eq(apiKeys.id, sql.placeholder("id")))
    .prepare(),
);

export async function findApiKeyByToken(db: Database, token: string): Promise<ApiKeyAuth | null> {
  const key = await apiKeyByHashQuery(db).get({ keyHash: hash(token) });
  if (!key) {
    return null;
  }
  const { lastUsedAt, ...auth } = key;
  // Match the DynamoDB store: record use at most once a minute instead of writing per request.
  const now = Date.now();
  if (!lastUsedAt || now - lastUsedAt.getTime() >= 60_000) {
    await touchApiKeyQuery(db).run({ id: key.id, now });
  }
  return auth;
}

export async function createApiKey(db: Database, accountId: string, name: string) {
  const token = `pp_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  await db.insert(apiKeys).values({ id, accountId: accountId, name, keyHash: hash(token) });
  return { ok: true as const, apiKey: { id, name }, token };
}
export async function revokeApiKey(db: Database, accountId: string, id: string) {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}
export function listAccountApiKeys(db: Database, accountId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function findOrCreateAccountForIdentity(
  db: Database,
  { provider, subject, profile = {} }: IdentityInput,
): Promise<IdentityAccount> {
  const candidate = `acct_${randomUUID()}`;
  const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
  const match = and(eq(identities.provider, provider), eq(identities.subject, subject));
  const identityAccount = db.select({ id: identities.accountId }).from(identities).where(match);
  const values = {
    email: profile.email ?? null,
    emailVerified: profile.emailVerified ?? null,
    displayName: profile.displayName ?? null,
    pictureUrl: profile.pictureUrl ?? null,
    piiSubject: profile.piiSubject ?? null,
    lastLoginAt: new Date(),
  };
  await db.atomic([
    statement(sql`insert into ${accounts} (id, name) select ${candidate}, ${accountName}
        where not exists ${identityAccount}`),
    statement(
      db
        .insert(identities)
        .values({
          id: randomUUID(),
          accountId: candidate,
          provider,
          subject,
          ...values,
        })
        .onConflictDoUpdate({
          target: [identities.provider, identities.subject],
          set: {
            ...values,
            piiSubject: sql`coalesce(${profile.piiSubject ?? null}, ${identities.piiSubject})`,
          },
        }),
    ),
    statement(
      db
        .update(accounts)
        .set({ name: accountName, updatedAt: new Date() })
        .where(eq(accounts.id, identityAccount)),
    ),
  ]);
  const [identity] = await db
    .select({
      accountId: identities.accountId,
      accountName: accounts.name,
      email: identities.email,
      pictureUrl: identities.pictureUrl,
    })
    .from(identities)
    .innerJoin(accounts, eq(accounts.id, identities.accountId))
    .where(match);
  if (!identity) {
    throw new Error("Identity missing after atomic write");
  }
  return identity;
}
