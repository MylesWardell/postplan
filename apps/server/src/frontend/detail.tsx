import type { Session } from "#auth/types";
import { Layout, page } from "./layout.js";
import type { AccountDraftDetail } from "@postplan/api";
import { date, Status } from "./shared.js";

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
                          href={`${draft.rawUrl.replace(/\/raw$/, "")}/v/${version.versionNumber}/raw`}
                        >
                          v{version.versionNumber} ↗
                        </a>
                        <span class="repo">{(version.fileSize / 1024).toFixed(1)} KB</span>
                      </td>
                      <td>
                        <span>{version.gitCommitSubject || version.gitBranch || "CLI upload"}</span>
                        {version.gitCommitSha && (
                          <div class="repo">
                            {version.gitCommitSha.slice(0, 7)}
                            {version.gitDirty ? " · uncommitted changes" : ""}
                          </div>
                        )}
                      </td>
                      <td class="nowrap muted">{date(version.createdAt)}</td>
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
