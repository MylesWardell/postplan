import type { ComponentChildren } from "preact";
import { renderToString } from "preact-render-to-string";
import type { AccountDraft, AccountDraftDetail, ApiKeySummary } from "@postplan/api";
import type { Session } from "../auth/types.js";
import { styles } from "./styles.js";

function Layout({
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
        <style>{styles}</style>
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
const date = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(value)
    : "—";
const Status = ({ disabled }: { disabled: boolean }) => (
  <span class={`badge${disabled ? " paused" : ""}`}>{disabled ? "Disabled" : "Published"}</span>
);
export function homeResponse(session: Session | null): Response {
  return page(
    <Layout title="Share your next idea" session={session}>
      <section class="hero">
        <p class="eyebrow">From local file to shared idea</p>
        <h1>
          Good work deserves
          <br />a simple link.
        </h1>
        <p>
          Publish an HTML draft from your terminal. Share it with your team, track each version, and
          keep your ideas moving.
        </p>
        <div class="actions">
          <a class="button" href="/dashboard">
            Open your drafts ↗
          </a>
          <a class="button secondary" href="/cli/auth">
            Connect your CLI
          </a>
        </div>
        <div class="hero-terminal">
          <code>$ postplan upload ./plan.html</code>
          <p>One file. One command. Ready to share.</p>
        </div>
      </section>
      <div class="stats">
        <div class="stat">
          <h2>Publish from anywhere</h2>
          <span>Made for your terminal and your agents.</span>
        </div>
        <div class="stat">
          <h2>Keep the whole story</h2>
          <span>Every version, with its git provenance.</span>
        </div>
        <div class="stat">
          <h2>Manage in one place</h2>
          <span>Edit details and control public access.</span>
        </div>
      </div>
    </Layout>,
  );
}
export function signInResponse(next: string): Response {
  return page(
    <Layout title="Sign in">
      <section class="narrow panel pad">
        <p class="eyebrow">Your workspace</p>
        <h1>Pick up where you left off.</h1>
        <p class="muted">
          Sign in to manage your drafts and create API keys for your CLI. Your account uses the
          email and profile you approve with Shoo.
        </p>
        <a class="button" href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>
          Continue with Shoo ↗
        </a>
      </section>
    </Layout>,
  );
}
export function messageResponse(title: string, message: string, status: number): Response {
  return page(
    <Layout title={title}>
      <section class="narrow panel pad">
        <p class="eyebrow">Postplan</p>
        <h1>{title}</h1>
        <p class="muted">{message}</p>
        <a class="button secondary" href="/dashboard">
          Back to drafts
        </a>
      </section>
    </Layout>,
    status,
  );
}
export const notFoundResponse = () =>
  messageResponse(
    "Page not found",
    "This draft or page is unavailable. Check the link or return to your workspace.",
    404,
  );
export function dashboardResponse(
  session: Session,
  drafts: AccountDraft[],
  query: string,
  status: string,
): Response {
  const filtered = drafts.filter(
    (draft) =>
      (!query ||
        `${draft.title} ${draft.description ?? ""} ${draft.repoName ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (status === "disabled" ? draft.disabled : status === "published" ? !draft.disabled : true),
  );
  return page(
    <Layout title="Your drafts" session={session} active="drafts">
      <p class="eyebrow">Workspace</p>
      <div class="heading">
        <div>
          <h1>Your drafts</h1>
          <p class="muted">A little less scattered. All your shared work, in one place.</p>
        </div>
        <a class="button" href="/cli/auth">
          Connect your CLI ↗
        </a>
      </div>
      <div class="stats">
        <div class="stat">
          <span>Total drafts</span>
          <strong>{drafts.length}</strong>
        </div>
        <div class="stat">
          <span>Published</span>
          <strong>{drafts.filter((draft) => !draft.disabled).length}</strong>
        </div>
        <div class="stat">
          <span>Saved versions</span>
          <strong>{drafts.reduce((sum, draft) => sum + draft.versionCount, 0)}</strong>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>
            Draft library <span class="muted">· {filtered.length}</span>
          </h2>
          <form class="search" method="get" action="/dashboard">
            <input
              type="search"
              name="q"
              aria-label="Search drafts"
              placeholder="Search drafts…"
              value={query}
            />
            <select name="status" aria-label="Publication status" value={status}>
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="disabled">Disabled</option>
            </select>
            <button class="secondary">Filter</button>
          </form>
        </div>
        {filtered.length ? (
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Draft</th>
                  <th>Status</th>
                  <th class="hide-small">Versions</th>
                  <th>Updated · UTC</th>
                  <th>
                    <span aria-label="Actions">↗</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((draft) => (
                  <tr key={draft.draftId}>
                    <td>
                      <a class="draft-title" href={`/dashboard/drafts/${draft.draftId}`}>
                        {draft.title}
                      </a>
                      <span class="description">
                        {draft.description || draft.repoName || "No description yet"}
                      </span>
                    </td>
                    <td>
                      <Status disabled={draft.disabled} />
                    </td>
                    <td class="hide-small">
                      v{draft.latestVersionNumber ?? 0}
                      <span class="repo"> · {draft.versionCount} saved</span>
                    </td>
                    <td class="nowrap muted">{date(draft.updatedAt)}</td>
                    <td>
                      <a
                        href={`/dashboard/drafts/${draft.draftId}`}
                        aria-label={`Manage ${draft.title}`}
                      >
                        Manage →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="empty">
            <span class="mark" aria-hidden="true">
              p
            </span>
            <h2>{drafts.length ? "No drafts match your filters" : "Your next idea starts here"}</h2>
            <p>
              {drafts.length
                ? "Try another search or clear your filters to see all your drafts."
                : "Connect your CLI, then publish your first HTML file. Every version will find a home here."}
            </p>
            <a class="button secondary" href={drafts.length ? "/dashboard" : "/cli/auth"}>
              {drafts.length ? "Clear filters" : "Set up your CLI"}
            </a>
          </div>
        )}
      </section>
      <div class="hint">
        <span>Upload a new draft from your terminal.</span>
        <code>postplan upload ./plan.html</code>
      </div>
    </Layout>,
  );
}
export function detailResponse(
  session: Session,
  { draft, versions }: AccountDraftDetail,
  saved: boolean,
): Response {
  const path = `/dashboard/drafts/${draft.draftId}`;
  return page(
    <Layout title={draft.title} session={session} active="drafts">
      <a class="breadcrumb" href="/dashboard">
        ← All drafts
      </a>
      <div class="heading">
        <div>
          <p class="eyebrow">Draft details</p>
          <h1>{draft.title}</h1>
          <Status disabled={draft.disabled} />
        </div>
        {!draft.disabled && (
          <a class="button secondary" href={draft.publicUrl} target="_blank" rel="noreferrer">
            Open public draft ↗
          </a>
        )}
      </div>
      {saved && (
        <div class="notice" role="status">
          Your changes have been saved.
        </div>
      )}
      <div class="grid">
        <div class="stack">
          <section class="panel pad">
            <h2>Make it easy to find</h2>
            <p class="muted">A clear title and description help your team find the right draft.</p>
            <form method="post" action={`${path}/update`}>
              <div class="field">
                <label for="title">Title</label>
                <input id="title" name="title" required maxLength={255} value={draft.title} />
              </div>
              <div class="field">
                <label for="description">Description</label>
                <textarea id="description" name="description" maxLength={1000}>
                  {draft.description ?? ""}
                </textarea>
              </div>
              <button>Save changes</button>
            </form>
          </section>
          <section class="panel">
            <div class="panel-head">
              <h2>Version history</h2>
              <span class="muted">{versions.length} saved</span>
            </div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Source</th>
                    <th>Saved · UTC</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td>
                        <a
                          class="draft-title"
                          href={`${draft.rawUrl.replace(/\/raw$/, "")}/v/${version.version_number}/raw`}
                        >
                          v{version.version_number} ↗
                        </a>
                        <span class="repo">{(version.file_size / 1024).toFixed(1)} KB</span>
                      </td>
                      <td>
                        <span>
                          {version.git_commit_subject || version.git_branch || "CLI upload"}
                        </span>
                        {version.git_commit_sha && (
                          <div class="repo">
                            {version.git_commit_sha.slice(0, 7)}
                            {version.git_dirty ? " · uncommitted changes" : ""}
                          </div>
                        )}
                      </td>
                      <td class="nowrap muted">{date(version.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <aside class="stack">
          <section class="panel pad">
            <h2>Public access</h2>
            <p class="muted">
              {draft.disabled
                ? "This draft and its versions are unavailable to visitors."
                : "Anyone with the link can view this draft and its versions."}
            </p>
            <form method="post" action={`${path}/${draft.disabled ? "enable" : "disable"}`}>
              <button class="secondary">
                {draft.disabled ? "Enable public access" : "Disable public access"}
              </button>
            </form>
          </section>
          <section class="panel pad">
            <h2>Keep iterating</h2>
            <p class="muted">Publish a new version to the same link.</p>
            <code>postplan upload ./plan.html --draft {draft.draftId}</code>
            <details>
              <summary>Delete this draft</summary>
              <p>
                This removes the draft from your workspace and disables all public links. This
                cannot be undone here.
              </p>
              <form method="post" action={`${path}/delete`}>
                <div class="field">
                  <label for="confirmation">Type DELETE to confirm</label>
                  <input
                    id="confirmation"
                    name="confirmation"
                    required
                    pattern="DELETE"
                    autoComplete="off"
                  />
                </div>
                <button class="danger">Delete draft</button>
              </form>
            </details>
          </section>
        </aside>
      </div>
    </Layout>,
  );
}
export function keysResponse(
  session: Session,
  keys: ApiKeySummary[],
  token?: string,
  keyName?: string,
): Response {
  return page(
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
                        <div class="repo">Created {date(key.created_at)}</div>
                      </td>
                      <td class="muted nowrap">{date(key.last_used_at)}</td>
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
    </Layout>,
  );
}
