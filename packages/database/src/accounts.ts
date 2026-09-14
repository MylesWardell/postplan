import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import { accounts, apiKeys, identities } from "./schema.js";

export interface ApiKeyAuth {
  id: string;
  account_id: string;
  name: string;
  account_name: string;
}
export const publicUploadAuth: ApiKeyAuth = {
  id: "key_public_upload",
  account_id: "acct_public_upload",
  name: "Public Uploads",
  account_name: "Public Uploads",
};
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function seedAccounts(db: Database, bootstrapKey?: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [auth, token] of [
      [publicUploadAuth, "postplan-public-upload-sentinel"],
      ...(bootstrapKey
        ? [
            [
              {
                id: "key_bootstrap",
                account_id: "acct_bootstrap",
                name: "Bootstrap API Key",
                account_name: "Bootstrap Account",
              },
              bootstrapKey,
            ] as const,
          ]
        : []),
    ] as const) {
      await tx
        .insert(accounts)
        .values({ id: auth.account_id, name: auth.account_name })
        .onConflictDoUpdate({ target: accounts.id, set: { updated_at: new Date() } });
      await tx
        .insert(apiKeys)
        .values({
          id: auth.id,
          account_id: auth.account_id,
          name: auth.name,
          key_hash: hash(token),
        })
        .onConflictDoUpdate({
          target: apiKeys.id,
          set: { key_hash: hash(token), name: auth.name, revoked_at: null },
        });
    }
  });
}

export async function findApiKeyByToken(db: Database, token: string): Promise<ApiKeyAuth | null> {
  const [key] = await db
    .select({
      id: apiKeys.id,
      account_id: apiKeys.account_id,
      name: apiKeys.name,
      account_name: accounts.name,
    })
    .from(apiKeys)
    .innerJoin(accounts, eq(accounts.id, apiKeys.account_id))
    .where(
      and(
        eq(apiKeys.key_hash, hash(token)),
        ne(apiKeys.id, publicUploadAuth.id),
        isNull(apiKeys.revoked_at),
      ),
    )
    .limit(1);
  if (!key) return null;
  await db.update(apiKeys).set({ last_used_at: new Date() }).where(eq(apiKeys.id, key.id));
  return key;
}

export async function createApiKey(db: Database, accountId: string, name: string) {
  const token = `pp_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  await db.insert(apiKeys).values({ id, account_id: accountId, name, key_hash: hash(token) });
  return { ok: true as const, apiKey: { id, name }, token };
}
export async function revokeApiKey(db: Database, accountId: string, id: string) {
  const rows = await db
    .update(apiKeys)
    .set({ revoked_at: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.account_id, accountId), isNull(apiKeys.revoked_at)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}
export function listAccountApiKeys(db: Database, accountId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      created_at: apiKeys.created_at,
      last_used_at: apiKeys.last_used_at,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.account_id, accountId), isNull(apiKeys.revoked_at)))
    .orderBy(desc(apiKeys.created_at));
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
  input: IdentityInput,
): Promise<IdentityAccount> {
  try {
    return await upsertIdentity(db, input);
  } catch (error) {
    // Drizzle wraps driver errors; retry the losing concurrent first login.
    if (postgresErrorCode(error) === "23505") return upsertIdentity(db, input);
    throw error;
  }
}
function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}
async function upsertIdentity(
  db: Database,
  { provider, subject, profile = {} }: IdentityInput,
): Promise<IdentityAccount> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(identities)
      .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
      .limit(1);
    const accountId = existing?.account_id ?? `acct_${randomUUID()}`;
    const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
    const values = {
      email: profile.email ?? null,
      email_verified: profile.emailVerified ?? null,
      display_name: profile.displayName ?? null,
      picture_url: profile.pictureUrl ?? null,
      pii_subject: profile.piiSubject ?? existing?.pii_subject ?? null,
      last_login_at: new Date(),
    };
    if (existing) {
      await tx.update(identities).set(values).where(eq(identities.id, existing.id));
      await tx
        .update(accounts)
        .set({ name: accountName, updated_at: new Date() })
        .where(eq(accounts.id, accountId));
    } else {
      await tx.insert(accounts).values({ id: accountId, name: accountName });
      await tx
        .insert(identities)
        .values({ id: randomUUID(), account_id: accountId, provider, subject, ...values });
    }
    return { accountId, accountName, email: values.email, pictureUrl: values.picture_url };
  });
}
