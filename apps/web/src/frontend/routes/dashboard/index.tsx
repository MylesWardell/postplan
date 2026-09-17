import { getOnly } from "#frontend/middleware/methods";
import { authenticated } from "#frontend/middleware/authenticated";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authenticatedContext } from "#frontend/context.server";
import { draftStatus, type DraftStatus } from "@postplan/api";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

const PAGE_SIZE = 25;

const loadDashboard = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        q: z.string().max(255).default(""),
        status: draftStatus.default("all"),
        cursor: z.string().max(512).optional(),
      })
      .prefault({}),
  )
  .handler(async ({ data, context }) => {
    const { session, caller } = authenticatedContext(getRequest(), context);
    const page = (cursor: string | undefined) =>
      caller.drafts.list({ limit: PAGE_SIZE, cursor, q: data.q, status: data.status });
    const [list, totals] = await Promise.all([
      page(data.cursor).catch((error: unknown) => {
        // A stale or edited cursor falls back to the first page.
        if (data.cursor && error instanceof ORPCError && error.code === "BAD_REQUEST") {
          return page(undefined);
        }
        throw error;
      }),
      caller.drafts.totals(),
    ]);
    // Serialize only what the page renders; URLs and repository details stay out of the payload.
    const drafts = list.drafts.map((draft) => ({
      draftId: draft.draftId,
      title: draft.title,
      summary: draft.description || draft.repoName || "No description yet",
      disabled: draft.disabled,
      latestVersionNumber: draft.latestVersionNumber,
      versionCount: draft.versionCount,
      updatedAt: draft.updatedAt,
    }));
    return { session, drafts, totals, nextCursor: list.nextCursor };
  });

import { Link, createFileRoute } from "@tanstack/react-router";
import { Layout } from "#frontend/layout";
import { date, Status } from "#frontend/shared";

export const Route = createFileRoute("/dashboard/")({
  server: { middleware: [getOnly, authenticated] },
  loader: async ({ location }) => {
    const params = new URL(location.href, "http://localhost").searchParams;
    const query = (params.get("q") ?? "").trim().slice(0, 255);
    const parsedStatus = draftStatus.safeParse(params.get("status"));
    const status: DraftStatus = parsedStatus.success ? parsedStatus.data : "all";
    const cursor = params.get("cursor")?.slice(0, 512) || undefined;
    return {
      ...(await loadDashboard({ data: { q: query, status, cursor } })),
      query,
      status,
      paged: cursor !== undefined,
    };
  },
  component: DashboardPage,
});

function dashboardHref(query: string, status: DraftStatus, cursor?: string) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (status !== "all") {
    params.set("status", status);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const search = params.toString();
  return search ? `/dashboard?${search}` : "/dashboard";
}

function DashboardPage() {
  const { session, drafts, totals, nextCursor, query, status, paged } = Route.useLoaderData();
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
          <strong>{totals.drafts}</strong>
        </div>
        <div className="stat">
          <span>Published</span>
          <strong>{totals.published}</strong>
        </div>
        <div className="stat">
          <span>Saved versions</span>
          <strong>{totals.versions}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>
            Draft library{" "}
            <span className="muted">
              · {drafts.length}
              {nextCursor || paged ? " on this page" : ""}
            </span>
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
        {drafts.length ? (
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
                {drafts.map((draft) => (
                  <tr key={draft.draftId}>
                    <td>
                      <Link
                        className="draft-title"
                        to="/dashboard/drafts/$draftId/"
                        params={{ draftId: draft.draftId }}
                      >
                        {draft.title}
                      </Link>
                      <span className="description">{draft.summary}</span>
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
            <h2>{totals.drafts ? "No drafts match your filters" : "Your next idea starts here"}</h2>
            <p>
              {totals.drafts
                ? "Try another search or clear your filters to see all your drafts."
                : "Connect your CLI, then publish your first HTML file. Every version will find a home here."}
            </p>
            <a className="button secondary" href={totals.drafts ? "/dashboard" : "/cli/auth"}>
              {totals.drafts ? "Clear filters" : "Set up your CLI"}
            </a>
          </div>
        )}
        {paged || nextCursor ? (
          <nav className="pager" aria-label="Draft pages">
            {paged ? <a href={dashboardHref(query, status)}>← First page</a> : <span />}
            {nextCursor ? <a href={dashboardHref(query, status, nextCursor)}>Next page →</a> : null}
          </nav>
        ) : null}
      </section>
      <div className="hint">
        <span>Upload a new draft from your terminal.</span>
        <code>postplan upload ./plan.html</code>
      </div>
    </Layout>
  );
}
