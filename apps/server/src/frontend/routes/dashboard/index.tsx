import { getOnly } from "../../methods.js";
import { authenticated } from "../../auth.js";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authenticatedContext } from "../../context.server.js";

const loadDashboard = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const { session, caller } = await authenticatedContext(getRequest(), context);
  return { session, drafts: (await caller.drafts.list()).drafts };
});

import { Link, createFileRoute } from "@tanstack/react-router";
import { Layout } from "../../layout.js";
import { date, Status } from "../../shared.js";

export const Route = createFileRoute("/dashboard/")({
  server: { middleware: [getOnly, authenticated] },
  loader: async ({ location }) => {
    const url = new URL(location.href, "http://localhost");
    return {
      ...(await loadDashboard()),
      query: url.searchParams.get("q") ?? "",
      status: url.searchParams.get("status") ?? "all",
    };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { session, drafts, query, status } = Route.useLoaderData();
  const filtered = drafts.filter(
    (draft) =>
      (!query ||
        `${draft.title} ${draft.description ?? ""} ${draft.repoName ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (status === "disabled" ? draft.disabled : status === "published" ? !draft.disabled : true),
  );
  return (
    <Layout title="Your drafts" session={session} active="drafts">
      <p className="eyebrow">Workspace</p>
      <div className="heading">
        <div>
          <h1>Your drafts</h1>
          <p className="muted">A little less scattered. All your shared work, in one place.</p>
        </div>
        <Link className="button" to="/cli/auth">
          Connect your CLI ↗
        </Link>
      </div>
      <div className="stats">
        <div className="stat">
          <span>Total drafts</span>
          <strong>{drafts.length}</strong>
        </div>
        <div className="stat">
          <span>Published</span>
          <strong>{drafts.filter((draft) => !draft.disabled).length}</strong>
        </div>
        <div className="stat">
          <span>Saved versions</span>
          <strong>{drafts.reduce((sum, draft) => sum + draft.versionCount, 0)}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>
            Draft library <span className="muted">· {filtered.length}</span>
          </h2>
          <form className="search" method="get" action="/dashboard">
            <input
              type="search"
              name="q"
              aria-label="Search drafts"
              placeholder="Search drafts…"
              defaultValue={query}
            />
            <select name="status" aria-label="Publication status" defaultValue={status}>
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="disabled">Disabled</option>
            </select>
            <button className="secondary">Filter</button>
          </form>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table className="library">
              <thead>
                <tr>
                  <th>Draft</th>
                  <th>Status</th>
                  <th className="hide-small">Versions</th>
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
                      <Link
                        className="draft-title"
                        to="/dashboard/drafts/$draftId/"
                        params={{ draftId: draft.draftId }}
                      >
                        {draft.title}
                      </Link>
                      <span className="description">
                        {draft.description || draft.repoName || "No description yet"}
                      </span>
                    </td>
                    <td>
                      <Status disabled={draft.disabled} />
                    </td>
                    <td className="hide-small">
                      v{draft.latestVersionNumber ?? 0}
                      <span className="repo"> · {draft.versionCount} saved</span>
                    </td>
                    <td className="nowrap muted">{date(draft.updatedAt)}</td>
                    <td>
                      <Link
                        to="/dashboard/drafts/$draftId/"
                        params={{ draftId: draft.draftId }}
                        aria-label={`Manage ${draft.title}`}
                      >
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <span className="mark" aria-hidden="true">
              p
            </span>
            <h2>{drafts.length ? "No drafts match your filters" : "Your next idea starts here"}</h2>
            <p>
              {drafts.length
                ? "Try another search or clear your filters to see all your drafts."
                : "Connect your CLI, then publish your first HTML file. Every version will find a home here."}
            </p>
            <a className="button secondary" href={drafts.length ? "/dashboard" : "/cli/auth"}>
              {drafts.length ? "Clear filters" : "Set up your CLI"}
            </a>
          </div>
        )}
      </section>
      <div className="hint">
        <span>Upload a new draft from your terminal.</span>
        <code>postplan upload ./plan.html</code>
      </div>
    </Layout>
  );
}
