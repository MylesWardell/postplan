import type { Child } from "hono/jsx";
import type { Session } from "#auth/types";

export function Layout({
  title,
  session,
  active,
  children,
}: {
  title: string;
  session?: Session | null;
  active?: string;
  children: Child;
}) {
  return (
    <Document title={title}>
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
    </Document>
  );
}

export function Document({ children, title }: { children: Child; title: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{`${title} · Postplan`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
