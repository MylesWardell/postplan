import {
  S3Client,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";

import type { CleanupStorage } from "@postplan/store-dynamodb/cleanup";

export function cleanupStorage(bucket: string, options: S3ClientConfig = {}): CleanupStorage {
  const client = new S3Client(options);
  async function remove(prefix: string, exact = false) {
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    do {
      const page = await client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
        }),
      );
      const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
        .filter((item) => item.Key && (!exact || item.Key === prefix))
        .map((item) => ({ Key: item.Key!, VersionId: item.VersionId }));
      if (objects.length) {
        const response = await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
        );
        if (response.Errors?.length) {
          throw new Error(`S3 cleanup failed for ${response.Errors.length} objects.`);
        }
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
      if (page.IsTruncated && !keyMarker) {
        throw new Error("Missing S3 version cursor.");
      }
    } while (keyMarker);
  }
  return {
    close: () => client.destroy(),
    deletePrefix: (prefix) => remove(prefix),
    deleteObject: (key) => remove(key, true),
    async listObjects(cursor) {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: "drafts/", ContinuationToken: cursor }),
      );
      return {
        objects: (page.Contents ?? [])
          .filter((item) => item.Key && item.LastModified)
          .map((item) => ({ key: item.Key!, modifiedAt: item.LastModified!.getTime() })),
        cursor: page.NextContinuationToken,
      };
    },
  };
}
