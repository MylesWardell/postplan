import { createHmac, timingSafeEqual } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { config } from "#config";
import { getHomeUrl, getRequestBaseUrl } from "#lib/public-url";
import type { Session } from "./types";

export const SESSION_COOKIE = "postplan_session";
export const AUTH_STATE_COOKIE = "postplan_auth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_STATE_TTL_SECONDS = 10 * 60;

export interface AuthState {
  state: string;
  verifier: string;
  next: string;
  exp: number;
}

type TokenPayload = Record<string, unknown> & { exp: number };

// Compact HMAC-signed tokens (base64url(JSON payload) + "." + HMAC-SHA256),
// the same shape shoo uses for its own sessions. Stateless: nothing to store
// or clean up server-side, and a restart invalidates nothing.
export function signToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowSeconds() + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmac(body, secret)}`;
}

export function verifyToken(token: unknown, secret: string): TokenPayload | null {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [body = "", signature] = token.split(".");
  const expected = hmac(body, secret);
  const a = Buffer.from(signature || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp < nowSeconds()) {
      return null;
    }
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export function createSessionCookie({
  accountId,
  accountName,
  email,
  pictureUrl,
}: {
  accountId: string;
  accountName: string;
  email?: string | null;
  pictureUrl?: string | null;
}): string {
  const token = signToken(
    { accountId, accountName, email: email ?? null, pictureUrl: pictureUrl ?? null },
    requireSecret(),
    SESSION_TTL_SECONDS,
  );
  return serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export function createAuthStateCookie(payload: Omit<AuthState, "exp">): string {
  const token = signToken({ ...payload }, requireSecret(), AUTH_STATE_TTL_SECONDS);
  return serializeCookie(AUTH_STATE_COOKIE, token, { maxAge: AUTH_STATE_TTL_SECONDS });
}

export function clearAuthStateCookie(): string {
  return serializeCookie(AUTH_STATE_COOKIE, "", { maxAge: 0 });
}

export function readSession(req: Request): Session | null {
  if (!config.sessionSecret) {
    return null;
  }
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) {
    return null;
  }
  const payload = verifyToken(token, config.sessionSecret);
  return payload?.accountId ? (payload as unknown as Session) : null;
}

// Cookie-authenticated requests must target the application host, and
// state-changing ones must originate from it (CSRF guard).
export function assertApplicationOrigin(req: Request): void {
  const home = new URL(
    getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: getRequestBaseUrl(req) }),
  );
  if (
    new URL(req.url).hostname !== home.hostname ||
    (req.method !== "GET" && req.headers.get("origin") !== home.origin)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Session requests must use the application origin.",
    });
  }
}

export function readAuthState(req: Request): AuthState | null {
  if (!config.sessionSecret) {
    return null;
  }
  const token = readCookie(req, AUTH_STATE_COOKIE);
  return token ? (verifyToken(token, config.sessionSecret) as AuthState | null) : null;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      // A malformed value (bad percent-escape) must read as "no cookie", not
      // throw — otherwise one bad cookie 500s every web page until cleared.
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serializeCookie(name: string, value: string, { maxAge }: { maxAge: number }): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV !== "development") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function requireSecret(): string {
  if (!config.sessionSecret) {
    throw new Error("POSTPLAN_SESSION_SECRET is not configured.");
  }
  return config.sessionSecret;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
