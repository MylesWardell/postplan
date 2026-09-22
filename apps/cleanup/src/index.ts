import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

import { createDynamoDatabase } from "@postplan/store-dynamodb";
import { cleanupPlans } from "@postplan/store-dynamodb/cleanup";
import { parseRetentionDays } from "@postplan/store/retention";

import { cleanupStorage } from "./storage";

export async function handler() {
  const db = createDynamoDatabase(
    {
      identity: required("POSTPLAN_IDENTITY_TABLE"),
      plans: required("POSTPLAN_PLANS_TABLE"),
      records: required("POSTPLAN_RECORDS_TABLE"),
      limits: required("POSTPLAN_RATE_LIMITS_TABLE"),
    },
    {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
      endpoint: process.env.POSTPLAN_DYNAMODB_ENDPOINT,
      retentionDays: () => parseRetentionDays(process.env.PLAN_RETENTION_DAYS),
    },
  );
  const endpoint = process.env.AWS_ENDPOINT_URL || process.env.S3_ENDPOINT;
  const storage = cleanupStorage(required("AWS_S3_BUCKET_NAME"), {
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    endpoint,
    forcePathStyle:
      (process.env.AWS_S3_FORCE_PATH_STYLE || (endpoint ? "true" : "false")) !== "false",
  });
  try {
    const result = await cleanupPlans(db, storage);
    const namespace = process.env.CLEANUP_METRIC_NAMESPACE;
    if (namespace) {
      const metrics = new CloudWatchClient({});
      try {
        await metrics.send(
          new PutMetricDataCommand({
            Namespace: namespace,
            MetricData: [
              {
                MetricName: "OldestPendingAgeSeconds",
                Value: result.oldestPendingAgeSeconds,
                Unit: "Seconds",
              },
            ],
          }),
        );
      } finally {
        metrics.destroy();
      }
    }
    return result;
  } finally {
    storage.close?.();
    db.client.destroy();
  }
}
if (import.meta.main) {
  const runtime = process.env.AWS_LAMBDA_RUNTIME_API;
  if (!runtime) {
    console.log(await handler());
  } else {
    const base = `http://${runtime}/2018-06-01/runtime/invocation`;
    while (true) {
      const event = await fetch(`${base}/next`);
      if (!event.ok) {
        throw new Error("Lambda runtime event fetch failed.");
      }
      await event.arrayBuffer();
      const id = event.headers.get("lambda-runtime-aws-request-id");
      if (!id) {
        throw new Error("Lambda runtime omitted request ID.");
      }
      let path = "response";
      let body: unknown;
      try {
        body = await handler();
      } catch (error) {
        path = "error";
        body = {
          errorType: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message : "Cleanup failed",
        };
      }
      const response = await fetch(`${base}/${id}/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        throw new Error("Lambda runtime response submission failed.");
      }
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
