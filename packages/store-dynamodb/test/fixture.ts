import { createDynamoStore } from "@postplan/store-dynamodb";
import { randomUUID } from "node:crypto";
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDatabase } from "@postplan/store-dynamodb/dynamo";

export const dynamoEndpoint = process.env.POSTPLAN_TEST_DYNAMODB_ENDPOINT;
export async function dynamoFixture(now: () => number = Date.now, retention?: () => number) {
  if (
    !dynamoEndpoint ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(dynamoEndpoint).hostname)
  ) {
    throw new Error(
      "DynamoDB integration tests require a loopback POSTPLAN_TEST_DYNAMODB_ENDPOINT.",
    );
  }
  const client = new DynamoDBClient({
    endpoint: dynamoEndpoint,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const prefix = `postplan-test-${randomUUID().replaceAll("-", "")}`;
  const tables = {
    identity: `${prefix}-identity`,
    plans: `${prefix}-plans`,
    records: `${prefix}-records`,
    limits: `${prefix}-limits`,
  };
  const created: string[] = [];
  try {
    for (const [kind, name] of Object.entries(tables)) {
      const hash = kind === "plans" || kind === "records" ? "draftId" : "pk";
      const range = kind === "identity" || kind === "records" ? "sk" : undefined;
      const byAccount = kind === "identity" || kind === "plans";
      const sort = kind === "identity" ? "createdAt" : "updatedAt";
      await client.send(
        new CreateTableCommand({
          TableName: name,
          BillingMode: "PAY_PER_REQUEST",
          KeySchema: [
            { AttributeName: hash, KeyType: "HASH" },
            ...(range ? [{ AttributeName: range, KeyType: "RANGE" as const }] : []),
          ],
          AttributeDefinitions: [
            { AttributeName: hash, AttributeType: "S" },
            ...(range ? [{ AttributeName: range, AttributeType: "S" as const }] : []),
            ...(byAccount
              ? [
                  { AttributeName: "accountId", AttributeType: "S" as const },
                  { AttributeName: sort, AttributeType: "N" as const },
                ]
              : []),
          ],
          ...(byAccount
            ? {
                GlobalSecondaryIndexes: [
                  {
                    IndexName: "by-account",
                    KeySchema: [
                      { AttributeName: "accountId", KeyType: "HASH" },
                      { AttributeName: sort, KeyType: "RANGE" },
                    ],
                    Projection: { ProjectionType: "ALL" },
                  },
                ],
              }
            : {}),
        }),
      );
      created.push(name);
    }
  } catch (error) {
    for (const name of created) {
      await client.send(new DeleteTableCommand({ TableName: name }));
    }
    client.destroy();
    throw error;
  }
  const db = new DynamoDatabase(
    DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }),
    tables,
    now,
    retention,
  );
  return {
    db,
    store: createDynamoStore(db).store,
    async close(this: void) {
      try {
        for (const name of created) {
          await client.send(new DeleteTableCommand({ TableName: name }));
        }
      } finally {
        client.destroy();
      }
    },
  };
}
