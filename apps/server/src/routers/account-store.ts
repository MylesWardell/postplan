import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accounts, apiKeys, identities } from "../db/schema.js";

export interface ApiKeyAuth {
  id: string;
  accountId: string;
  name: string;
  accountName: string;
}
export const publicUploadAuth: ApiKeyAuth = {
  id: "key_public_upload",
  accountId: "acct_public_upload",
  name: "Public Uploads",
  accountName: "Public Uploads",
};
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function seedAccounts(db: Database, bootstrapKey?: string): Promise<void> {
  await db.transaction((tx) => {
    for (const [auth, token] of [
      [publicUploadAuth, "postplan-public-upload-sentinel"],
      ...(bootstrapKey
        ? [
            [
              {
                id: "key_bootstrap",
                accountId: "acct_bootstrap",
                name: "Bootstrap API Key",
                accountName: "Bootstrap Account",
              },
              bootstrapKey,
            ] as const,
          ]
        : []),
    ] as const) {
      tx.insert(accounts)
        .values({ id: auth.accountId, name: auth.accountName })
        .onConflictDoUpdate({ target: accounts.id, set: { updatedAt: new Date() } })
        .run();
      tx.insert(apiKeys)
        .values({
          id: auth.id,
          accountId: auth.accountId,
          name: auth.name,
          keyHash: hash(token),
        })
        .onConflictDoUpdate({
          target: apiKeys.id,
          set: { keyHash: hash(token), name: auth.name, revokedAt: null },
        })
        .run();
    }
  });
}

export async function findApiKeyByToken(db: Database, token: string): Promise<ApiKeyAuth | null> {
  const [key] = await db
    .select({
      id: apiKeys.id,
      accountId: apiKeys.accountId,
      name: apiKeys.name,
      accountName: accounts.name,
    })
    .from(apiKeys)
    .innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
    .where(
      and(
        eq(apiKeys.keyHash, hash(token)),
        ne(apiKeys.id, publicUploadAuth.id),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!key) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return key;
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

export interface IdentityProfile {
  email?: string | null;
  emailVerified?: boolean | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  piiSubject?: string | null;
}
export interface IdentityAccount {
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
}
export interface IdentityInput {
  provider: string;
  subject: string;
  profile?: IdentityProfile;
}

export async function findOrCreateAccountForIdentity(
  db: Database,
  { provider, subject, profile = {} }: IdentityInput,
): Promise<IdentityAccount> {
  return db.transaction(
    (tx) => {
      const [existing] = tx
        .select()
        .from(identities)
        .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
        .limit(1)
        .all();
      const accountId = existing?.accountId ?? `acct_${randomUUID()}`;
      const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
      const values = {
        email: profile.email ?? null,
        emailVerified: profile.emailVerified ?? null,
        displayName: profile.displayName ?? null,
        pictureUrl: profile.pictureUrl ?? null,
        piiSubject: profile.piiSubject ?? existing?.piiSubject ?? null,
        lastLoginAt: new Date(),
      };
      if (existing) {
        tx.update(identities).set(values).where(eq(identities.id, existing.id)).run();
        tx.update(accounts)
          .set({ name: accountName, updatedAt: new Date() })
          .where(eq(accounts.id, accountId))
          .run();
      } else {
        tx.insert(accounts).values({ id: accountId, name: accountName }).run();
        tx.insert(identities)
          .values({ id: randomUUID(), accountId: accountId, provider, subject, ...values })
          .run();
      }
      return { accountId, accountName, email: values.email, pictureUrl: values.pictureUrl };
    },
    { behavior: "immediate" },
  );
}
