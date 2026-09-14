import { ORPCError } from "@orpc/server";
import { config } from "../../config.js";
import { findOrCreateAccountForIdentity } from "../../routers/account-store.js";
import type { Database } from "../../db/client.js";
import { createCaller } from "../../client.js";
import type { ContextFactory } from "../../context.js";
import { parseFormData, getIssueMessage } from "@orpc/openapi/helpers";
import { getHomeUrl } from "../../lib/public-url.js";
import { toHttpError } from "../../lib/respond.js";
import { buildAuthorizeUrl, buildPkce, exchangeCode, verifyIdToken } from "../../auth/shoo.js";
import {
  assertApplicationOrigin,
  clearAuthStateCookie,
  clearSessionCookie,
  createAuthStateCookie,
  createSessionCookie,
  readAuthState,
  readSession,
} from "../../auth/session.js";
import {
  homeResponse,
  signInResponse,
  messageResponse,
  dashboardResponse,
  detailResponse,
  keysResponse,
} from "../pages.js";

function redirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: path });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function webResponse(
  req: Request,
  db: Database,
  context: ContextFactory,
  peerIp: string | null,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "GET" && path === "/") return homeResponse(readSession(req));
  if (!/^\/(auth|dashboard|cli\/auth)(\/|$)/.test(path)) return;
  if (!config.sessionSecret || !config.publicBaseUrl)
    return messageResponse(
      "Sign-in unavailable",
      "Web sign-in has not been configured for this deployment.",
      503,
    );
  if (req.method === "GET" && path === "/auth/sign-in") {
    const { verifier, challenge, state } = buildPkce();
    return redirect(buildAuthorizeUrl({ redirectUri: callbackUrl(), state, challenge }), [
      createAuthStateCookie({ state, verifier, next: safeNextPath(url.searchParams.get("next")) }),
    ]);
  }
  if (req.method === "GET" && path === "/auth/callback") {
    const response = await authCallback(req, db);
    response.headers.append("Set-Cookie", clearAuthStateCookie());
    return response;
  }
  const session = readSession(req);
  if (!session) return signInResponse(safeNextPath(path));
  try {
    // Checked up front so routes that never reach a procedure (sign-out) stay CSRF-safe.
    assertApplicationOrigin(req);
    const caller = createCaller(context(req, peerIp, true));
    if (req.method === "POST" && path === "/auth/sign-out")
      return redirect("/", [clearSessionCookie()]);
    if (req.method === "GET" && path === "/dashboard")
      return dashboardResponse(
        session,
        (await caller.drafts.list()).drafts,
        url.searchParams.get("q") ?? "",
        url.searchParams.get("status") ?? "all",
      );
    if (req.method === "GET" && path === "/cli/auth")
      return keysResponse(session, await caller.apiKeys.list());
    if (req.method === "POST" && path === "/cli/auth/keys") {
      const form = parseFormData(await req.formData());
      const keyName = form.name || `CLI · ${new Date().toISOString().slice(0, 10)}`;
      const { token } = await caller.apiKeys.create({ name: keyName });
      return keysResponse(session, await caller.apiKeys.list(), token, keyName);
    }
    const key = path.match(/^\/cli\/auth\/keys\/([^/]+)\/revoke$/);
    if (req.method === "POST" && key) {
      await caller.apiKeys.revoke({ apiKeyId: key[1]! });
      return redirect("/cli/auth");
    }
    const draft = path.match(/^\/dashboard\/drafts\/([^/]+)(?:\/(update|disable|enable|delete))?$/);
    if (draft) {
      const draftId = draft[1]!;
      if (req.method === "GET" && !draft[2])
        return detailResponse(
          session,
          await caller.drafts.detail({ draftId }),
          url.searchParams.get("saved") === "1",
        );
      if (req.method === "POST" && draft[2]) {
        const form = parseFormData(await req.formData());
        switch (draft[2]) {
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
            if (form.confirmation !== "DELETE")
              throw new ORPCError("BAD_REQUEST", { message: "Type DELETE to confirm deletion." });
            await caller.drafts.delete({ draftId });
            return redirect("/dashboard");
        }
        return redirect(`/dashboard/drafts/${draftId}?saved=1`);
      }
    }
  } catch (error) {
    const { failure, status } = toHttpError(error);
    return messageResponse(
      "Request could not be completed",
      status >= 500
        ? "Please try again in a moment."
        : (getIssueMessage(failure, "title") ??
            getIssueMessage(failure, "description") ??
            getIssueMessage(failure, "name") ??
            failure.message),
      status,
    );
  }
}

async function authCallback(req: Request, db: Database): Promise<Response> {
  const params = new URL(req.url).searchParams;
  if (params.get("error") === "access_denied")
    return messageResponse(
      "Sign-in cancelled",
      "Consent was declined. Retry sign-in and approve to continue.",
      403,
    );
  const state = readAuthState(req);
  if (!state || params.get("state") !== state.state)
    return messageResponse(
      "Sign-in expired",
      "The sign-in state did not match. Please retry.",
      400,
    );
  const code = params.get("code");
  if (!code) return messageResponse("Sign-in incomplete", "Missing authorization code.", 400);
  let claims;
  try {
    const tokens = await exchangeCode({
      code,
      verifier: state.verifier,
      redirectUri: callbackUrl(),
    });
    claims = await verifyIdToken(tokens.id_token, { audOrigin: webOrigin() });
  } catch (error) {
    console.error("shoo sign-in failed:", error);
    return messageResponse(
      "Sign-in unavailable",
      "Sign-in could not be completed. Please retry.",
      502,
    );
  }
  const account = await findOrCreateAccountForIdentity(db, {
    provider: "shoo",
    subject: claims.pairwise_sub,
    profile: {
      email: claimText(claims.email),
      emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
      displayName: claimText(claims.name),
      pictureUrl: claimText(claims.picture),
      piiSubject: claimText(claims.pii_sub),
    },
  });
  return redirect(safeNextPath(state.next), [createSessionCookie(account)]);
}

function webOrigin(): string {
  return getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: "" });
}

function callbackUrl(): string {
  return `${webOrigin()}/auth/callback`;
}

function claimText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

// Only allow same-site relative paths as post-login destinations, so the
// `next` param can never become an open redirect.
function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}
