import type { ComponentChildren } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Session } from "../auth/types.js";
import { styles } from "./styles.js";

export function Layout({
  title,
  session,
  active,
  children,
}: {
  title: string;
  session?: Session | null;
  active?: string;
  children: ComponentChildren;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Postplan</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <header class="topbar">
          <div class="shell">
            <a class="brand" href="/">
              <span class="mark" aria-hidden="true">
                p
              </span>
              postplan
            </a>
            <nav class="nav" aria-label="Main navigation">
              <a href="/dashboard" aria-current={active === "drafts" ? "page" : undefined}>
                Drafts
              </a>
              <a href="/cli/auth" aria-current={active === "keys" ? "page" : undefined}>
                API keys
              </a>
            </nav>
            <div class="identity">
              {session ? (
                <>
                  <span class="account-name">{session.email || session.accountName}</span>
                  <form method="post" action="/auth/sign-out">
                    <button>Sign out</button>
                  </form>
                </>
              ) : (
                <a href="/auth/sign-in">Sign in ↗</a>
              )}
            </div>
          </div>
        </header>
        <main class="shell">{children}</main>
        <footer>
          <div class="shell">
            <span>Postplan · A home for work in progress.</span>
            <span>Publish. Share. Keep moving.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
export function page(element: ReturnType<typeof Layout>, status = 200): Response {
  return new Response("<!doctype html>" + renderToString(element), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}
