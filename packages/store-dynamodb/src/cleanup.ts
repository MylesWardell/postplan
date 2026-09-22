import { BatchWriteCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { DynamoDatabase, Item } from "./dynamo";
import { conditionalFailure, decode } from "./dynamo";
import { claimExpiredPlan } from "./dynamo-drafts";
import type { DynamoPlan, UploadIntent } from "./dynamo-drafts";

export interface StoredObject {
  key: string;
  modifiedAt: number;
}
export interface CleanupStorage {
  close?(): void;
  deletePrefix(prefix: string): Promise<void>;
  listObjects(cursor?: string): Promise<{ objects: StoredObject[]; cursor?: string }>;
  deleteObject(key: string): Promise<void>;
}
export async function cleanupPlans(
  db: DynamoDatabase,
  storage: CleanupStorage,
  deadline = Date.now() + 240_000,
) {
  const seconds = () => Math.floor(db.now() / 1000);
  let oldest = 0;
  const checkpoint = { draftId: "_cleanup", sk: "CURSOR" };
  const saved = await db.get<{ plans?: Item; objects?: string }>(db.tables.records, checkpoint);
  let cursor = saved?.plans;
  let processed = 0;
  do {
    const page = await db.scanPage({
      TableName: db.tables.plans,
      ConsistentRead: true,
      ExclusiveStartKey: cursor,
      Limit: 25,
    });
    for (const item of page.Items ?? []) {
      const plan = decode(item) as unknown as DynamoPlan;
      if (plan.state !== "DELETING") {
        const claimed = await claimExpiredPlan(db, plan);
        if (!claimed && plan.state === "ACTIVE") {
          await cleanAbandonedIntents(db, storage, plan.draftId);
        }
        continue;
      }
      if (typeof plan.deletionStartedAt !== "number") {
        throw new Error("Missing deletion start time.");
      }
      oldest = Math.max(oldest, seconds() - plan.deletionStartedAt);
      if (seconds() - plan.deletionStartedAt < 86400) {
        continue;
      }
      if (!/^[a-z0-9]{12}$/.test(plan.draftId)) {
        throw new Error("Invalid cleanup draft ID.");
      }
      // The durable parent survives every failure until both stores are empty.
      await storage.deletePrefix(`drafts/${plan.draftId}/`);
      const records = await db.query<Item>({
        TableName: db.tables.records,
        ConsistentRead: true,
        ProjectionExpression: "draftId, sk",
        KeyConditionExpression: "draftId = :id",
        ExpressionAttributeValues: { ":id": plan.draftId },
      });
      for (let index = 0; index < records.length; index += 25) {
        let pending = records
          .slice(index, index + 25)
          .map((row) => ({ DeleteRequest: { Key: { draftId: row.draftId, sk: row.sk } } }));
        for (let retry = 0; pending.length; retry++) {
          const result = await db.client.send(
            new BatchWriteCommand({ RequestItems: { [db.tables.records]: pending } }),
          );
          pending = (result.UnprocessedItems?.[db.tables.records] ?? []) as typeof pending;
          if (pending.length) {
            if (retry >= 7) {
              throw new Error("Cleanup batch remained unprocessed.");
            }
            await Bun.sleep(Math.min(1000, 25 * 2 ** retry));
          }
        }
      }
      await db.transact([
        {
          Put: {
            TableName: db.tables.plans,
            Item: { draftId: plan.draftId, state: "DELETED", ttlAt: seconds() + 7 * 86400 },
            ConditionExpression: "#state = :deleting AND revision = :revision",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":deleting": "DELETING", ":revision": plan.revision },
          },
        },
      ]);
      processed++;
    }
    cursor = page.LastEvaluatedKey;
    await db.put(db.tables.records, {
      ...checkpoint,
      ...(cursor ? { plans: cursor } : {}),
      ...(saved?.objects ? { objects: saved.objects } : {}),
    });
    if (Date.now() >= deadline) {
      return { processed, oldestPendingAgeSeconds: oldest };
    }
  } while (cursor);

  let objectCursor = saved?.objects;
  do {
    const page = await storage.listObjects(objectCursor);
    for (const object of page.objects) {
      if (object.modifiedAt > db.now() - 86400_000) {
        continue;
      }
      const match = /^drafts\/([a-z0-9]{12})\/versions\/([a-f0-9-]{36})\.html$/.exec(object.key);
      if (!match) {
        continue;
      }
      const [, draftId, versionId] = match;
      const intentKey = { draftId: draftId!, sk: `INTENT#${versionId}` };
      const intent = await db.get<UploadIntent>(db.tables.records, intentKey);
      if (intent?.status === "COMMITTED" || (intent && intent.leaseUntil > seconds())) {
        continue;
      }
      // Fence publication before deleting a stale pending upload.
      if (intent) {
        try {
          await db.client.send(
            new UpdateCommand({
              TableName: db.tables.records,
              Key: intentKey,
              UpdateExpression: "SET #status = :aborted",
              ConditionExpression: "#status = :pending AND leaseUntil <= :now",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":aborted": "ABORTED",
                ":pending": "PENDING",
                ":now": seconds(),
              },
            }),
          );
        } catch (error) {
          if (!conditionalFailure(error)) {
            throw error;
          }
          const current = await db.get<{ status: string }>(db.tables.records, intentKey);
          if (current?.status !== "ABORTED") {
            continue;
          }
        }
      }
      const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId: draftId! });
      // Imported versions may have no intents. Never infer orphanhood from that alone.
      if (plan && plan.state !== "DELETED") {
        const versions = await db.query<{ objectKey: string }>({
          TableName: db.tables.records,
          ConsistentRead: true,
          ProjectionExpression: "objectKey",
          KeyConditionExpression: "draftId = :id AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":id": draftId, ":prefix": "VERSION#" },
        });
        if (versions.some((version) => version.objectKey === object.key)) {
          continue;
        }
      }
      await storage.deleteObject(object.key);
      if (intent) {
        await db.client.send(new DeleteCommand({ TableName: db.tables.records, Key: intentKey }));
      }
    }
    objectCursor = page.cursor;
    await db.put(db.tables.records, {
      ...checkpoint,
      ...(objectCursor ? { objects: objectCursor } : {}),
    });
    if (Date.now() >= deadline) {
      break;
    }
  } while (objectCursor);
  return { processed, oldestPendingAgeSeconds: oldest };
}

async function cleanAbandonedIntents(db: DynamoDatabase, storage: CleanupStorage, draftId: string) {
  const intents = await db.query<UploadIntent>({
    TableName: db.tables.records,
    ConsistentRead: true,
    KeyConditionExpression: "draftId = :id AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: { ":id": draftId, ":prefix": "INTENT#" },
  });
  for (const intent of intents) {
    if (
      intent.status === "COMMITTED" ||
      intent.createdAt.getTime() > db.now() - 86400_000 ||
      intent.leaseUntil > Math.floor(db.now() / 1000)
    ) {
      continue;
    }
    if (!intent.objectKey.startsWith(`drafts/${draftId}/versions/`)) {
      throw new Error("Invalid intent object key.");
    }
    const key = { draftId, sk: intent.sk };
    try {
      await db.client.send(
        new UpdateCommand({
          TableName: db.tables.records,
          Key: key,
          UpdateExpression: "SET #status = :aborted",
          ConditionExpression: "(#status = :pending OR #status = :aborted) AND leaseUntil <= :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":aborted": "ABORTED",
            ":pending": "PENDING",
            ":now": Math.floor(db.now() / 1000),
          },
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) {
        continue;
      }
      throw error;
    }
    await storage.deleteObject(intent.objectKey);
    await db.client.send(new DeleteCommand({ TableName: db.tables.records, Key: key }));
  }
}
