import { createHash, randomUUID } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ORPCError } from "@orpc/server";
import { encode, optimistic, conditionalFailure } from "./dynamo";
import type { DynamoDatabase } from "./dynamo";
import type { ApiKeyAuth, IdentityInput, IdentityAccount } from "@postplan/store";

interface Account {
  id: string;
  name: string;
  createdAt: Date;
}
export interface DynamoApiKey {
  pk: string;
  sk: string;
  id: string;
  accountId: string;
  name: string;
  keyHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}
interface Identity {
  accountId: string;
  piiSubject?: string | null;
  revision: number;
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const keyAddress = (id: string) => ({ pk: `KEY#${id}`, sk: "META" });
const accountAddress = (id: string) => ({ pk: `ACCOUNT#${id}`, sk: "META" });
const tokenAddress = (tokenHash: string) => ({ pk: `TOKEN#${tokenHash}`, sk: "META" });

export async function seedDynamoAccounts(db: DynamoDatabase, bootstrapKey?: string) {
  const accounts = [
    { id: "acct_public_upload", name: "Public Uploads" },
    ...(bootstrapKey ? [{ id: "acct_bootstrap", name: "Bootstrap Account" }] : []),
  ];
  for (const account of accounts) {
    try {
      await db.put(
        db.tables.identity,
        { ...accountAddress(account.id), ...account, createdAt: db.now() },
        "attribute_not_exists(pk)",
      );
    } catch (error) {
      if (!conditionalFailure(error)) {
        throw error;
      }
    }
  }
  if (bootstrapKey) {
    await optimistic(async () => {
      const existing = await db.get<DynamoApiKey>(db.tables.identity, keyAddress("key_bootstrap"));
      const keyHash = hash(bootstrapKey);
      const key = {
        ...keyAddress("key_bootstrap"),
        id: "key_bootstrap",
        accountId: "acct_bootstrap",
        name: "Bootstrap API Key",
        keyHash,
        createdAt: existing?.createdAt ?? new Date(db.now()),
        lastUsedAt: existing?.lastUsedAt ?? null,
        revokedAt: null,
      };
      await db.transact([
        {
          Put: {
            TableName: db.tables.identity,
            Item: encode(key),
            ConditionExpression: existing ? "keyHash = :old" : "attribute_not_exists(pk)",
            ...(existing ? { ExpressionAttributeValues: { ":old": existing.keyHash } } : {}),
          },
        },
        {
          Put: {
            TableName: db.tables.identity,
            Item: { ...tokenAddress(keyHash), keyId: key.id },
            ConditionExpression: "attribute_not_exists(pk) OR keyId = :id",
            ExpressionAttributeValues: { ":id": key.id },
          },
        },
        ...(existing && existing.keyHash !== keyHash
          ? [{ Delete: { TableName: db.tables.identity, Key: tokenAddress(existing.keyHash) } }]
          : []),
      ]);
    });
  }
}
export async function findDynamoApiKey(
  db: DynamoDatabase,
  token: string,
): Promise<ApiKeyAuth | null> {
  const keyHash = hash(token);
  const lookup = await db.get<{ keyId: string }>(db.tables.identity, tokenAddress(keyHash));
  if (!lookup) {
    return null;
  }
  const key = await db.get<DynamoApiKey>(db.tables.identity, keyAddress(lookup.keyId));
  if (!key || key.revokedAt || key.keyHash !== keyHash || key.id === "key_public_upload") {
    return null;
  }
  const account = await db.get<Account>(db.tables.identity, accountAddress(key.accountId));
  if (!account) {
    return null;
  }
  if (!key.lastUsedAt || db.now() - key.lastUsedAt.getTime() >= 60_000) {
    try {
      await db.client.send(
        new UpdateCommand({
          TableName: db.tables.identity,
          Key: keyAddress(key.id),
          UpdateExpression: "SET lastUsedAt = :now",
          ConditionExpression:
            "keyHash = :hash AND (attribute_not_exists(revokedAt) OR revokedAt = :nil)",
          ExpressionAttributeValues: { ":now": db.now(), ":hash": keyHash, ":nil": null },
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) {
        return null;
      }
      throw error;
    }
  }
  return { id: key.id, name: key.name, accountId: account.id, accountName: account.name };
}
export async function createDynamoApiKey(db: DynamoDatabase, accountId: string, name: string) {
  const token = `pp_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  await db.transact([
    {
      ConditionCheck: {
        TableName: db.tables.identity,
        Key: accountAddress(accountId),
        ConditionExpression: "attribute_exists(pk)",
      },
    },
    {
      Put: {
        TableName: db.tables.identity,
        Item: {
          ...keyAddress(id),
          id,
          accountId,
          name,
          keyHash: hash(token),
          createdAt: db.now(),
          lastUsedAt: null,
          revokedAt: null,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
    {
      Put: {
        TableName: db.tables.identity,
        Item: { ...tokenAddress(hash(token)), keyId: id },
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
  ]);
  return { ok: true as const, apiKey: { id, name }, token };
}
export async function revokeDynamoApiKey(db: DynamoDatabase, accountId: string, id: string) {
  try {
    await db.client.send(
      new UpdateCommand({
        TableName: db.tables.identity,
        Key: keyAddress(id),
        UpdateExpression: "SET revokedAt = :now",
        ConditionExpression:
          "accountId = :owner AND (attribute_not_exists(revokedAt) OR revokedAt = :nil)",
        ExpressionAttributeValues: { ":now": db.now(), ":owner": accountId, ":nil": null },
      }),
    );
    return true;
  } catch (error) {
    if (conditionalFailure(error)) {
      return false;
    }
    throw error;
  }
}
export async function listDynamoApiKeys(db: DynamoDatabase, accountId: string) {
  const candidates = await db.query<DynamoApiKey>({
    TableName: db.tables.identity,
    IndexName: "by-account",
    KeyConditionExpression: "accountId = :owner",
    ExpressionAttributeValues: { ":owner": accountId },
    ScanIndexForward: false,
  });
  const result: Pick<DynamoApiKey, "id" | "name" | "createdAt" | "lastUsedAt">[] = [];
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.pk.startsWith("KEY#")) {
      continue;
    }
    const key = await db.get<DynamoApiKey>(db.tables.identity, keyAddress(candidate.id));
    if (key && key.accountId === accountId && !key.revokedAt) {
      result.push({
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      });
    }
  }
  return result;
}
export async function findDynamoIdentity(
  db: DynamoDatabase,
  { provider, subject, profile = {} }: IdentityInput,
): Promise<IdentityAccount> {
  const pk = `IDENTITY#${hash(JSON.stringify([provider, subject]))}`;
  return optimistic(async () => {
    const identity = await db.get<Identity>(db.tables.identity, { pk, sk: "META" });
    const accountId = identity?.accountId ?? `acct_${randomUUID()}`;
    const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
    const account = identity
      ? await db.get<Account>(db.tables.identity, accountAddress(accountId))
      : undefined;
    if (identity && !account) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Account is unavailable." });
    }
    await db.transact([
      {
        Put: {
          TableName: db.tables.identity,
          Item: {
            pk,
            sk: "META",
            accountId,
            provider,
            subject,
            ...profile,
            piiSubject: profile.piiSubject ?? identity?.piiSubject ?? null,
            revision: (identity?.revision ?? 0) + 1,
            lastLoginAt: db.now(),
          },
          ConditionExpression: identity ? "revision = :revision" : "attribute_not_exists(pk)",
          ...(identity ? { ExpressionAttributeValues: { ":revision": identity.revision } } : {}),
        },
      },
      {
        Put: {
          TableName: db.tables.identity,
          Item: {
            ...accountAddress(accountId),
            id: accountId,
            name: accountName,
            createdAt: account?.createdAt.getTime() ?? db.now(),
            updatedAt: db.now(),
          },
          ConditionExpression: identity ? "attribute_exists(pk)" : "attribute_not_exists(pk)",
        },
      },
    ]);
    return {
      accountId,
      accountName,
      email: profile.email ?? null,
      pictureUrl: profile.pictureUrl ?? null,
    };
  });
}
