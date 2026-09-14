import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { config, requireEnv } from "#config";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (client) return client;

  const options: S3ClientConfig = {
    region: requireEnv("AWS_DEFAULT_REGION", config.s3.region),
    forcePathStyle: config.s3.forcePathStyle,
  };
  if (config.s3.endpoint) {
    options.endpoint = config.s3.endpoint;
  }
  // Static keys only when both are supplied; otherwise fall through to the
  // SDK's default provider chain (ECS task role, instance profile, SSO, ...).
  if (config.s3.accessKeyId && config.s3.secretAccessKey) {
    options.credentials = {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    };
  }

  client = new S3Client(options);
  return client;
}

export function assertStorageConfigured(): void {
  requireEnv("AWS_S3_BUCKET_NAME", config.s3.bucketName);
  requireEnv("AWS_DEFAULT_REGION", config.s3.region);
  if (Boolean(config.s3.accessKeyId) !== Boolean(config.s3.secretAccessKey)) {
    throw new Error("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither.");
  }
}

export async function putHtmlObject(key: string, html: string): Promise<void> {
  assertStorageConfigured();
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "no-store",
    }),
  );
}

export async function getHtmlObject(key: string): Promise<string> {
  assertStorageConfigured();
  const result = await getClient().send(
    new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    }),
  );
  if (!result.Body) {
    throw new Error(`S3 object ${key} has no body.`);
  }
  return result.Body.transformToString("utf-8");
}
