import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { getAuth } from "#frontend/auth";
import type { AuthState } from "#frontend/auth";
import type { ReactNode } from "react";
import { Layout } from "#frontend/layout";

export const Route = createRootRoute({
  beforeLoad: async (): Promise<{ auth: AuthState }> => ({ auth: await getAuth() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [{ rel: "stylesheet", href: "/assets/styles.css" }],
  }),
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: () => (
    <Layout title="Page not found">
      <h1>Page not found</h1>
      <p>This draft or page is unavailable. Check the link or return to your workspace.</p>
    </Layout>
  ),
  errorComponent: () => (
    <Layout title="Request could not be completed">
      <h1>Request could not be completed</h1>
      <p>Please try again in a moment.</p>
    </Layout>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
