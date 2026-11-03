import assert from "node:assert/strict";

import { test } from "vitest";

import { routeTemplate } from "../src/instrumentation";

test("span routes collapse caller-chosen identifiers", () => {
  assert.equal(routeTemplate("/"), "/");
  assert.equal(routeTemplate("/healthz"), "/healthz");
  assert.equal(routeTemplate("/api/uploads"), "/api/uploads");
  assert.equal(routeTemplate("/d/kms-migration-plan/raw"), "/d/:id/raw");
  assert.equal(routeTemplate("/d/abc/v/12/raw"), "/d/:id/v/:id/raw");
  assert.equal(routeTemplate("/v/3/raw"), "/v/:id/raw");
  assert.equal(routeTemplate("/dashboard/drafts/my-plan/disable"), "/dashboard/drafts/:id/disable");
  assert.equal(
    routeTemplate("/cli/auth/keys/0b6c1f4e-8f0e-4d7e-9a43-7e2f3b1c9d10/revoke"),
    "/cli/auth/keys/:id/revoke",
  );
});
