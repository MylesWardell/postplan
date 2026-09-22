import type { Session } from "#auth/types";
import type { ApiKeySummary } from "@postplan/api";

import { Layout } from "../layout";
import { date } from "../shared";
export interface KeysPageProps {
  session: Session;
  keys: ApiKeySummary[];
  token?: string;
  keyName?: string;
}
export function KeysPage({ session, keys, token, keyName }: KeysPageProps) {
  return (
    <Layout title="API keys" session={session} active="keys">
      <p class="eyebrow">Developer settings</p>
      <div class="heading">
        <div>
          <h1>A key to your workspace.</h1>
          <p class="muted">Connect your terminal and publish drafts to your account.</p>
        </div>
      </div>
      {token && (
        <section class="notice" role="status">
          <h2>{keyName} is ready</h2>
          <p>
            Copy this key now. It will only be shown once. Paste it into the CLI login prompt or
            use:
          </p>
          <code class="token">postplan auth set {token}</code>
        </section>
      )}
      <div class="grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Your API keys</h2>
            <span class="muted">{keys.length} active</span>
          </div>
          {keys.length ? (
            <div class="table-scroll">
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
                        <div class="repo">Created {date(key.createdAt)}</div>
                      </td>
                      <td class="muted nowrap">{date(key.lastUsedAt)}</td>
                      <td>
                        <form method="post" action={`/cli/auth/keys/${key.id}/revoke`}>
                          <button class="secondary" aria-label={`Revoke ${key.name}`}>
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
            <div class="empty">
              <h2>No keys yet</h2>
              <p>Create a named key for each device or agent that publishes on your behalf.</p>
            </div>
          )}
        </section>
        <aside class="panel pad">
          <h2>Create a key</h2>
          <p class="muted">Give it a name you will recognize later.</p>
          <form method="post" action="/cli/auth/keys">
            <div class="field">
              <label for="key-name">Key name</label>
              <input id="key-name" name="name" placeholder="Work laptop" required maxLength={255} />
            </div>
            <button>Create API key</button>
          </form>
        </aside>
      </div>
      <div class="hint">
        <span>API keys grant access to all drafts in your account. Keep them private.</span>
        <code>postplan auth login</code>
      </div>
    </Layout>
  );
}
