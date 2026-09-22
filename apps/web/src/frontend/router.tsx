import { parseFormData } from "@orpc/openapi/helpers";
import { ORPCError } from "@orpc/server";
import { Hono, type MiddlewareHandler } from "hono";

import { completeSignIn, safeNextPath, signIn } from "#auth/handlers";
import { assertApplicationOrigin, clearSessionCookie, readSession } from "#auth/session";
import { redirect } from "#lib/redirect";

import {
  authenticatedContext,
  requireConfiguredSignIn,
  type AppRequestContext,
} from "./context.server";
import { loadDashboard, loadDraft } from "./loaders";
import { notFoundResponse, page } from "./response.server";
import { DashboardPage } from "./views/dashboard";
import { DetailPage } from "./views/detail";
import { HomePage } from "./views/home";
import { KeysPage } from "./views/keys";
import { signInResponse } from "./views/sign-in";
import { webAction } from "./web";

// Astro dispatches document requests here. No browser router or server-function transport.
export const frontend = new Hono<{ Bindings: AppRequestContext }>({ strict: false });
frontend.use("*", (c, next) =>
  webAction(async () => {
    await next();
    return c.res;
  }),
);
frontend.onError((error) => {
  throw error;
});
frontend.notFound(() => notFoundResponse());
frontend.get("/", (c) => page(<HomePage session={readSession(c.req.raw)} />));
frontend.get("/healthz", async (c) => {
  try {
    await c.env.deps.store.health();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});
frontend.get("/auth/sign-in", (c) => {
  requireConfiguredSignIn();
  return signIn(c.req.raw);
});
frontend.get("/auth/callback", (c) => {
  requireConfiguredSignIn();
  return completeSignIn(c.req.raw, c.env.deps.store);
});

const authenticated: MiddlewareHandler<{ Bindings: AppRequestContext }> = async (c, next) => {
  requireConfiguredSignIn();
  const request = c.req.raw;
  if (!readSession(request) || request.headers.has("authorization")) {
    const url = new URL(request.url);
    return signInResponse(safeNextPath(url.pathname + url.search));
  }
  assertApplicationOrigin(request);
  await next();
  return c.res;
};
frontend.get("/dashboard", authenticated, async (c) =>
  page(<DashboardPage {...await loadDashboard(c.req.raw, c.env)} />),
);
frontend.get("/dashboard/drafts/:draftId", authenticated, async (c) =>
  page(<DetailPage {...await loadDraft(c.req.raw, c.env, c.req.param("draftId"))} />),
);
frontend.get("/cli/auth", authenticated, async (c) => {
  const { session, caller } = authenticatedContext(c.req.raw, c.env);
  return page(<KeysPage session={session} keys={await caller.apiKeys.list()} />);
});
frontend.post("/auth/sign-out", authenticated, () => redirect("/", [clearSessionCookie()]));
frontend.post("/cli/auth/keys", authenticated, async (c) => {
  const { session, caller } = authenticatedContext(c.req.raw, c.env);
  const form = parseFormData(await c.req.raw.formData());
  const keyName = form.name || `CLI · ${new Date().toISOString().slice(0, 10)}`;
  const { token } = await caller.apiKeys.create({ name: keyName });
  return page(
    <KeysPage
      session={session}
      keys={await caller.apiKeys.list()}
      token={token}
      keyName={keyName}
    />,
  );
});
frontend.post("/cli/auth/keys/:keyId/revoke", authenticated, async (c) => {
  const { caller } = authenticatedContext(c.req.raw, c.env);
  await caller.apiKeys.revoke({ apiKeyId: c.req.param("keyId") });
  return redirect("/cli/auth");
});
frontend.post("/dashboard/drafts/:draftId/:action", authenticated, async (c) => {
  const { caller } = authenticatedContext(c.req.raw, c.env);
  const draftId = c.req.param("draftId");
  const form = parseFormData(await c.req.raw.formData());
  switch (c.req.param("action")) {
    case "update":
      await caller.drafts.update({
        draftId,
        title: form.title ?? "",
        description: form.description || null,
      });
      break;
    case "disable":
      await caller.drafts.disable({ draftId });
      break;
    case "enable":
      await caller.drafts.enable({ draftId });
      break;
    case "delete":
      if (form.confirmation !== "DELETE") {
        throw new ORPCError("BAD_REQUEST", { message: "Type DELETE to confirm deletion." });
      }
      await caller.drafts.delete({ draftId });
      return redirect("/dashboard");
    default:
      return notFoundResponse();
  }
  return redirect(`/dashboard/drafts/${draftId}?saved=1`);
});
