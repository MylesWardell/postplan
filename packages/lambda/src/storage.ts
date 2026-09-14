import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
interface StorageOptions {
  region?: string;
  bucketName?: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}
function requireEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
export function s3Storage(storage: StorageOptions) {
  let client: S3Client | undefined;

  function getClient(): S3Client {
    if (client) {
      return client;
    }

    const options: S3ClientConfig = {
      region: requireEnv("AWS_DEFAULT_REGION", storage.region),
      forcePathStyle: storage.forcePathStyle,
    };
    if (storage.endpoint) {
      options.endpoint = storage.endpoint;
    }
    // Static keys only when both are supplied; otherwise fall through to the
    // SDK's default provider chain (ECS task role, instance profile, SSO, ...).
    if (storage.accessKeyId && storage.secretAccessKey) {
      options.credentials = {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        sessionToken: storage.sessionToken,
      };
    }

    client = new S3Client(options);
    return client;
  }

  function assertStorageConfigured(): void {
    requireEnv("AWS_S3_BUCKET_NAME", storage.bucketName);
    requireEnv("AWS_DEFAULT_REGION", storage.region);
    if (Boolean(storage.accessKeyId) !== Boolean(storage.secretAccessKey)) {
      throw new Error("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither.");
    }
  }

  async function putHtmlObject(key: string, html: string): Promise<void> {
    assertStorageConfigured();
    await getClient().send(
      new PutObjectCommand({
        Bucket: storage.bucketName,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8",
        CacheControl: "no-store",
      }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
  }

  async function getHtmlObject(key: string): Promise<string> {
    assertStorageConfigured();
    const result = await getClient().send(
      new GetObjectCommand({
        Bucket: storage.bucketName,
        Key: key,
      }),
    );
    if (!result.Body) {
      throw new Error(`S3 object ${key} has no body.`);
    }
    return result.Body.transformToString("utf-8");
  }

  return { assertStorageConfigured, putHtmlObject, getHtmlObject };
}
