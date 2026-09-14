import { expect, test } from "bun:test";

test("AWS startup decrypts SSM secrets and preserves session credentials for S3", async () => {
  const requests: { target: string | null; token: string | null; body: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const target = request.headers.get("x-amz-target");
      requests.push({
        target,
        token: request.headers.get("x-amz-security-token"),
        body: await request.text(),
      });
      if (target) {
        return Response.json({
          Parameter: { Type: "SecureString", Value: "test-decrypted-secret" },
        });
      }
      return new Response("");
    },
  });
  try {
    const process = Bun.spawn(
      [
        "bun",
        "--conditions=source",
        "-e",
        `
      import { loadRuntimeSecrets } from "./src/lib/secrets.ts";
      await loadRuntimeSecrets();
      if (process.env.POSTPLAN_SESSION_SECRET !== "test-decrypted-secret") throw new Error("Secret not loaded");
      const { putHtmlObject } = await import("./src/lib/s3.ts");
      await putHtmlObject("drafts/test/versions/file.html", "<p>test</p>");
    `,
      ],
      {
        cwd: import.meta.dir + "/..",
        env: {
          ...globalThis.process.env,
          AWS_REGION: "us-east-1",
          AWS_DEFAULT_REGION: "us-east-1",
          AWS_ACCESS_KEY_ID: "test-access",
          AWS_SECRET_ACCESS_KEY: "test-secret",
          AWS_SESSION_TOKEN: "test-session-token",
          AWS_ENDPOINT_URL_SSM: server.url.href,
          AWS_S3_BUCKET_NAME: "test-bucket",
          AWS_ENDPOINT_URL: server.url.href,
          AWS_ENDPOINT_URL_S3: server.url.href,
          AWS_S3_FORCE_PATH_STYLE: "true",
          POSTPLAN_SESSION_SECRET_PARAMETER_ARN: "test-session-secret",
          POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = await new Response(process.stderr).text();
    expect(await process.exited, stderr).toBe(0);
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      Name: "test-session-secret",
      WithDecryption: true,
    });
    expect(requests.every((request) => request.token === "test-session-token")).toBe(true);
  } finally {
    await server.stop(true);
  }
}, 15_000);
