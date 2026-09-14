import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getDraftIdFromHost,
  getDraftPublicUrl,
  getDraftRawUrl,
  getHomeUrl,
} from "../src/public-url.js";

const wildcard = "https://*.postplan.dev";
const draftId = "abc123def456";

test("wildcard base URL produces subdomain public URLs and apex raw URLs", () => {
  assert.equal(
    getDraftPublicUrl({ draftId, publicBaseUrl: wildcard, requestBaseUrl: "http://ignored" }),
    `https://${draftId}.postplan.dev`,
  );
  assert.equal(
    getDraftRawUrl({ draftId, publicBaseUrl: wildcard, requestBaseUrl: "http://ignored" }),
    `https://postplan.dev/d/${draftId}/raw`,
  );
  assert.equal(getHomeUrl({ publicBaseUrl: wildcard, requestBaseUrl: "" }), "https://postplan.dev");
});

test("plain base URL uses /d/ paths", () => {
  assert.equal(
    getDraftPublicUrl({ draftId, publicBaseUrl: "https://plans.example.com/", requestBaseUrl: "" }),
    `https://plans.example.com/d/${draftId}`,
  );
});

test("falls back to the request base URL when unconfigured", () => {
  assert.equal(
    getDraftRawUrl({ draftId, publicBaseUrl: undefined, requestBaseUrl: "http://localhost:3000" }),
    `http://localhost:3000/d/${draftId}/raw`,
  );
  assert.equal(
    getHomeUrl({ publicBaseUrl: undefined, requestBaseUrl: "http://localhost:3000/" }),
    "http://localhost:3000",
  );
});

test("extracts draft ids only from valid single-label subdomains", () => {
  assert.equal(
    getDraftIdFromHost({ publicBaseUrl: wildcard, host: `${draftId}.postplan.dev` }),
    draftId,
  );
  assert.equal(
    getDraftIdFromHost({
      publicBaseUrl: wildcard,
      host: `${draftId.toUpperCase()}.postplan.dev:443`,
    }),
    draftId,
  );
  assert.equal(getDraftIdFromHost({ publicBaseUrl: wildcard, host: "postplan.dev" }), null);
  assert.equal(
    getDraftIdFromHost({ publicBaseUrl: wildcard, host: `x.${draftId}.postplan.dev` }),
    null,
  );
  assert.equal(getDraftIdFromHost({ publicBaseUrl: wildcard, host: "short.postplan.dev" }), null);
  assert.equal(getDraftIdFromHost({ publicBaseUrl: wildcard, host: `${draftId}.evil.dev` }), null);
  assert.equal(
    getDraftIdFromHost({ publicBaseUrl: "https://postplan.dev", host: `${draftId}.postplan.dev` }),
    null,
  );
});
