import assert from "node:assert/strict";

import { expect, test } from "vitest";

import { cleanupStorage } from "../src/storage";

test("S3 cleanup includes session credentials and rejects partial deletion", async () => {
  const tokens: (string | null)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      tokens.push(request.headers.get("x-amz-security-token"));
      if (request.method === "GET") {
        return new Response(
          '<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Version><Key>drafts/test/versions/file.html</Key><VersionId>null</VersionId></Version></ListVersionsResult>',
        );
      }
      return new Response(
        '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Error><Key>drafts/test/versions/file.html</Key><Code>AccessDenied</Code></Error></DeleteResult>',
      );
    },
  });
  const storage = cleanupStorage("test-bucket", {
    region: "us-east-1",
    endpoint: server.url.href,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test", sessionToken: "test-session" },
  });
  try {
    await assert.rejects(storage.deletePrefix("drafts/test/"), /S3 cleanup failed/);
    expect(tokens).toEqual(["test-session", "test-session"]);
  } finally {
    storage.close?.();
    await server.stop(true);
  }
});
