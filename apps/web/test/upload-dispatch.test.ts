import assert from "node:assert/strict";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { test, vi } from "vitest";

import { config } from "#config";
import { createTestStore } from "@postplan/store/testing";

import { createApplication } from "../src/application";

test("uploads never dispatch through Astro or the oRPC HTTP handler", async () => {
  const { store, close } = await createTestStore();
  const previous = { ...config };
  const apiHandle = vi.spyOn(OpenAPIHandler.prototype, "handle");
  let pageCalls = 0;
  try {
    config.publicBaseUrl = "https://plans.example.com";
    config.allowAnonymousUploads = false;
    await store.accounts.seed({ bootstrapKey: "dispatch-test" });
    const application = createApplication(
      {
        store,
        putHtml: async () => {},
        getHtml: async () => "",
      },
      {
        renderFrontend: async (request, context) => {
          pageCalls++;
          return context.api(request, context.peerIp);
        },
      },
    );
    const response = await application(
      new Request("https://plans.example.com/api/uploads", {
        method: "POST",
        headers: { authorization: "Bearer dispatch-test", "content-type": "application/json" },
        body: JSON.stringify({ html: "<!doctype html><title>Direct upload</title><p>Test</p>" }),
      }),
    );
    assert.equal(response.status, 201);
    assert.equal((await response.json()).ok, true);
    assert.equal(pageCalls, 0);
    assert.equal(apiHandle.mock.calls.length, 0);
    await application(
      new Request("https://plans.example.com/api/me", {
        headers: { authorization: "Bearer dispatch-test" },
      }),
    );
    assert.equal(pageCalls, 1);
    assert.equal(apiHandle.mock.calls.length, 1);
  } finally {
    apiHandle.mockRestore();
    Object.assign(config, previous);
    await close();
  }
});
