import { config } from "#config";
import type { Database } from "#db/client";
import { findOrCreateAccountForIdentity } from "#routers/account-store";
import { getHomeUrl } from "#lib/public-url";
import { redirect } from "#lib/redirect";
import { messageResponse } from "#frontend/response.server";
import { buildAuthorizeUrl, buildPkce, exchangeCode, verifyIdToken } from "./shoo.js";
import {
  clearAuthStateCookie,
  createAuthStateCookie,
  createSessionCookie,
  readAuthState,
} from "./session.js";

export function signIn(req: Request): Response {
  const { verifier, challenge, state } = buildPkce();
  return redirect(buildAuthorizeUrl({ redirectUri: callbackUrl(), state, challenge }), [
    createAuthStateCookie({
      state,
      verifier,
      next: safeNextPath(new URL(req.url).searchParams.get("next")),
    }),
  ]);
}

export async function completeSignIn(req: Request, db: Database): Promise<Response> {
  const response = await authCallback(req, db);
  response.headers.append("Set-Cookie", clearAuthStateCookie());
  return response;
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
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}
