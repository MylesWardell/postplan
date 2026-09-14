import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import type { Session } from "#auth/types";
import { assertApplicationOrigin, readSession } from "#auth/session";
import { requireConfiguredSignIn } from "./context.server.js";
import { Layout } from "./layout.js";
import { page } from "./response.server.js";
import { safeNextPath } from "#auth/handlers";
import { webAction } from "./web.js";

export interface AuthState {
  session: Session | null;
}

export const getAuth = createServerFn({ method: "GET" }).handler(() => ({
  session: readSession(getRequest()),
}));

export async function requireAuth({
  context,
  location,
}: {
  context: { auth: AuthState };
  location: { href: string };
}): Promise<{ auth: AuthState }> {
  const { auth } = context;
  if (!auth.session && typeof window !== "undefined")
    throw redirect({ href: location.href, reloadDocument: true });
  return { auth };
}

// Server routes run independently of router beforeLoad, so protect document and form requests too.
export const authenticated = createMiddleware().server(async ({ request, next }) =>
  webAction(async () => {
    requireConfiguredSignIn();
    if (!readSession(request) || request.headers.has("authorization")) {
      const url = new URL(request.url);
      return signInResponse(safeNextPath(url.pathname + url.search));
    }
    // Checked up front so routes that never reach a procedure (sign-out) stay CSRF-safe.
    assertApplicationOrigin(request);
    return (await next()).response;
  }),
);

function signInResponse(next: string): Response {
  return page(
    <Layout title="Sign in">
      <section className="narrow panel pad">
        <p className="eyebrow">Your workspace</p>
        <h1>Pick up where you left off.</h1>
        <p className="muted">
          Sign in to manage your drafts and create API keys for your CLI. Your account uses the
          email and profile you approve with Shoo.
        </p>
        <a className="button" href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>
          Continue with Shoo ↗
        </a>
      </section>
    </Layout>,
  );
}
