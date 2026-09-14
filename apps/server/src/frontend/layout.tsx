import type { ReactNode } from "react";
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
  children: ReactNode;
}) {
  return (
    <>
      <title>{`${title} · Postplan`}</title>
      <header className="topbar">
        <div className="shell">
          <a className="brand" href="/">
            <span className="mark" aria-hidden="true">
              p
            </span>
            postplan
          </a>
          <nav className="nav" aria-label="Main navigation">
            <a href="/dashboard" aria-current={active === "drafts" ? "page" : undefined}>
              Drafts
            </a>
            <a href="/cli/auth" aria-current={active === "keys" ? "page" : undefined}>
              API keys
            </a>
          </nav>
          <div className="identity">
            {session ? (
              <>
                <span className="account-name">{session.email || session.accountName}</span>
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
      <main className="shell">{children}</main>
      <footer>
        <div className="shell">
          <span>Postplan · A home for work in progress.</span>
          <span>Publish. Share. Keep moving.</span>
        </div>
      </footer>
    </>
  );
}

export function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
