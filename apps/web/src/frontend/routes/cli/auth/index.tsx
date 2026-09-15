import { getOnly } from "#frontend/middleware/methods";
import { authenticated } from "#frontend/middleware/authenticated";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authenticatedContext } from "#frontend/context.server";

const loadKeys = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const { session, caller } = authenticatedContext(getRequest(), context);
  return { session, keys: await caller.apiKeys.list() };
});

import { createFileRoute } from "@tanstack/react-router";
import type { ApiKeySummary } from "@postplan/api";
import type { Session } from "#auth/types";

export interface KeysPageProps {
  session: Session;
  keys: ApiKeySummary[];
  token?: string;
  keyName?: string;
}

import { Layout } from "#frontend/layout";
import { date } from "#frontend/shared";

export const Route = createFileRoute("/cli/auth/")({
  server: { middleware: [getOnly, authenticated] },
  loader: () => loadKeys(),
  component: () => <KeysPage {...Route.useLoaderData()} />,
});

export function KeysPage({ session, keys, token, keyName }: KeysPageProps) {
  return (
    <Layout title="API keys" session={session} active="keys">
      <p className="eyebrow">Developer settings</p>
      <div className="heading">
        <div>
          <h1>A key to your workspace.</h1>
          <p className="muted">Connect your terminal and publish drafts to your account.</p>
        </div>
      </div>
      {token && (
        <section className="notice" role="status">
          <h2>{keyName} is ready</h2>
          <p>
            Copy this key now. It will only be shown once. Paste it into the CLI login prompt or
            use:
          </p>
          <code className="token">postplan auth set {token}</code>
        </section>
      )}
      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Your API keys</h2>
            <span className="muted">{keys.length} active</span>
          </div>
          {keys.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Last used · UTC</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <strong>{key.name}</strong>
                        <div className="repo">Created {date(key.createdAt)}</div>
                      </td>
                      <td className="muted nowrap">{date(key.lastUsedAt)}</td>
                      <td>
                        <form method="post" action={`/cli/auth/keys/${key.id}/revoke`}>
                          <button className="secondary" aria-label={`Revoke ${key.name}`}>
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <h2>No keys yet</h2>
              <p>Create a named key for each device or agent that publishes on your behalf.</p>
            </div>
          )}
        </section>
        <aside className="panel pad">
          <h2>Create a key</h2>
          <p className="muted">Give it a name you will recognize later.</p>
          <form method="post" action="/cli/auth/keys">
            <div className="field">
              <label htmlFor="key-name">Key name</label>
              <input id="key-name" name="name" placeholder="Work laptop" required maxLength={255} />
            </div>
            <button>Create API key</button>
          </form>
        </aside>
      </div>
      <div className="hint">
        <span>API keys grant access to all drafts in your account. Keep them private.</span>
        <code>postplan auth login</code>
      </div>
    </Layout>
  );
}
