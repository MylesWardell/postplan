import { getOnly } from "#frontend/methods";
import { authenticated } from "#frontend/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authenticatedContext } from "#frontend/context.server";
import { z } from "zod";

const loadDraft = createServerFn({ method: "GET" })
  .validator(z.object({ draftId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { session, caller } = await authenticatedContext(getRequest(), context);
    try {
      return { session, ...(await caller.drafts.detail(data)) };
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") throw notFound();
      throw error;
    }
  });

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ORPCError } from "@orpc/server";
import { Layout } from "#frontend/layout";
import { date, Status } from "#frontend/shared";

export const Route = createFileRoute("/dashboard/drafts/$draftId/")({
  server: { middleware: [getOnly, authenticated] },
  loader: async ({ location, params }) => ({
    ...(await loadDraft({ data: { draftId: params.draftId } })),
    saved: new URL(location.href, "http://localhost").searchParams.get("saved") === "1",
  }),
  component: DetailPage,
});

function DetailPage() {
  const { session, draft, versions, saved } = Route.useLoaderData();
  const path = `/dashboard/drafts/${draft.draftId}`;
  return (
    <Layout title={draft.title} session={session} active="drafts">
      <Link className="breadcrumb" to="/dashboard">
        ← All drafts
      </Link>
      <div className="heading">
        <div>
          <p className="eyebrow">Draft details</p>
          <h1>{draft.title}</h1>
          <Status disabled={draft.disabled} />
        </div>
        {!draft.disabled && (
          <a className="button secondary" href={draft.publicUrl} target="_blank" rel="noreferrer">
            Open public draft ↗
          </a>
        )}
      </div>
      {saved && (
        <div className="notice" role="status">
          Your changes have been saved.
        </div>
      )}
      <div className="grid">
        <div className="stack">
          <section className="panel pad">
            <h2>Make it easy to find</h2>
            <p className="muted">
              A clear title and description help your team find the right draft.
            </p>
            <form method="post" action={`${path}/update`}>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input
                  id="title"
                  name="title"
                  required
                  maxLength={255}
                  defaultValue={draft.title}
                />
              </div>
              <div className="field">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  maxLength={1000}
                  defaultValue={draft.description ?? ""}
                />
              </div>
              <button>Save changes</button>
            </form>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Version history</h2>
              <span className="muted">{versions.length} saved</span>
            </div>
            <div className="table-scroll">
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
                          className="draft-title"
                          href={`${draft.rawUrl.replace(/\/raw$/, "")}/v/${version.versionNumber}/raw`}
                        >
                          v{version.versionNumber} ↗
                        </a>
                        <span className="repo">{(version.fileSize / 1024).toFixed(1)} KB</span>
                      </td>
                      <td>
                        <span>{version.gitCommitSubject || version.gitBranch || "CLI upload"}</span>
                        {version.gitCommitSha && (
                          <div className="repo">
                            {version.gitCommitSha.slice(0, 7)}
                            {version.gitDirty ? " · uncommitted changes" : ""}
                          </div>
                        )}
                      </td>
                      <td className="nowrap muted">{date(version.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <aside className="stack">
          <section className="panel pad">
            <h2>Public access</h2>
            <p className="muted">
              {draft.disabled
                ? "This draft and its versions are unavailable to visitors."
                : "Anyone with the link can view this draft and its versions."}
            </p>
            <form method="post" action={`${path}/${draft.disabled ? "enable" : "disable"}`}>
              <button className="secondary">
                {draft.disabled ? "Enable public access" : "Disable public access"}
              </button>
            </form>
          </section>
          <section className="panel pad">
            <h2>Keep iterating</h2>
            <p className="muted">Publish a new version to the same link.</p>
            <code>postplan upload ./plan.html --draft {draft.draftId}</code>
            <details>
              <summary>Delete this draft</summary>
              <p>
                This removes the draft from your workspace and disables all public links. This
                cannot be undone here.
              </p>
              <form method="post" action={`${path}/delete`}>
                <div className="field">
                  <label htmlFor="confirmation">Type DELETE to confirm</label>
                  <input
                    id="confirmation"
                    name="confirmation"
                    required
                    pattern="DELETE"
                    autoComplete="off"
                  />
                </div>
                <button className="danger">Delete draft</button>
              </form>
            </details>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
