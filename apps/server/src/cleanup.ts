import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { createRuntimeDatabase } from "./db/client";
import { isDynamoDatabase } from "./db/dynamo";
import { cleanupPlans } from "./db/cleanup";
import { cleanupStorage } from "./lib/cleanup-storage";

export async function handler() {
  const connection = createRuntimeDatabase();
  if (!isDynamoDatabase(connection.db)) {
    connection.close();
    throw new Error("Cleanup requires DynamoDB table configuration.");
  }
  const storage = cleanupStorage();
  try {
    const result = await cleanupPlans(connection.db, storage);
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
    connection.close();
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
