import { requestContext } from "./start.js";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import type { Session } from "../auth/types.js";
import { readSession } from "../auth/session.js";
import { requireConfiguredSignIn } from "./context.server.js";
import { Layout } from "./layout.js";
import { page } from "./response.server.js";
import { safeNextPath } from "../auth/handlers.js";
import { webAction } from "../http/web.js";

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
export const authenticated = createMiddleware()
  .middleware([requestContext])
  .server(async ({ request, context, next }) =>
    webAction(async () => {
      requireConfiguredSignIn();
      const apiContext = await context.resolveContext(request, true, context.peerIp);
      if (!apiContext.session) {
        const url = new URL(request.url);
        return signInResponse(safeNextPath(url.pathname + url.search));
      }
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
