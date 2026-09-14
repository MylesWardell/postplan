import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  QueryCommandInput,
  ScanCommandInput,
  TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

export interface DynamoTables {
  identity: string;
  plans: string;
  records: string;
  limits: string;
}
export type Item = Record<string, unknown>;
export class DynamoDatabase {
  readonly kind = "dynamodb";
  constructor(
    readonly client: DynamoDBDocumentClient,
    readonly tables: DynamoTables,
    readonly now: () => number = Date.now,
    readonly retentionDays: () => number = () => 90,
  ) {}
  async get<T>(table: string, key: Item): Promise<T | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: table, Key: key, ConsistentRead: true }),
    );
    return response.Item ? (decode(response.Item) as T) : undefined;
  }
  async put(table: string, item: Item, condition?: string) {
    await this.client.send(
      new PutCommand({ TableName: table, Item: encode(item), ConditionExpression: condition }),
    );
  }
  async query<T>(input: QueryCommandInput): Promise<T[]> {
    const items: T[] = [];
    let cursor = input.ExclusiveStartKey;
    do {
      const page = await this.client.send(
        new QueryCommand({ ...input, ExclusiveStartKey: cursor }),
      );
      items.push(...(page.Items ?? []).map((item) => decode(item) as T));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return items;
  }
  async scanPage(input: ScanCommandInput) {
    return this.client.send(new ScanCommand(input));
  }
  async transact(
    items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
    token = crypto.randomUUID(),
  ) {
    await this.client.send(
      new TransactWriteCommand({ TransactItems: items, ClientRequestToken: token }),
    );
  }
  async health() {
    await this.get(this.tables.plans, { draftId: "_health" });
  }
}
export function createDynamoDatabase(
  tables: DynamoTables,
  options: {
    endpoint?: string;
    region?: string;
    now?: () => number;
    retentionDays?: () => number;
  } = {},
) {
  const client = new DynamoDBClient({
    region: options.region,
    endpoint: options.endpoint,
    ...(options.endpoint
      ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  return new DynamoDatabase(
    DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }),
    tables,
    options.now,
    options.retentionDays,
  );
}
const dateFields = new Set([
  "createdAt",
  "updatedAt",
  "lastUsedAt",
  "revokedAt",
  "deletedAt",
  "disabledAt",
  "lastLoginAt",
]);
export function encode(item: object): Item {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [
      key,
      value instanceof Date ? value.getTime() : value,
    ]),
  );
}
export function decode(item: Item): Item {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [
      key,
      dateFields.has(key) && typeof value === "number" ? new Date(value) : value,
    ]),
  );
}
export function conditionalFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    error.name === "ConditionalCheckFailedException" ||
    error.name === "TransactionConflictException"
  ) {
    return true;
  }
  if (error.name !== "TransactionCanceledException") {
    return false;
  }
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] })
    .CancellationReasons;
  return (
    !!reasons?.some(
      (reason) => reason.Code === "ConditionalCheckFailed" || reason.Code === "TransactionConflict",
    ) &&
    reasons.every(
      (reason) =>
        !reason.Code ||
        ["None", "ConditionalCheckFailed", "TransactionConflict"].includes(reason.Code),
    )
  );
}
export async function optimistic<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!conditionalFailure(error) || attempt >= 15) {
        throw error;
      }
      await Bun.sleep(Math.min(100, 5 * 2 ** attempt) + Math.random() * 20);
    }
  }
}
