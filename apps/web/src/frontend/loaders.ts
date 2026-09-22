import { ORPCError } from "@orpc/server";

import { draftStatus } from "@postplan/api";

import { authenticatedContext, type AppRequestContext } from "./context.server";

export async function loadDashboard(request: Request, context: AppRequestContext) {
  const { session, caller } = authenticatedContext(request, context);
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 255);
  const parsedStatus = draftStatus.safeParse(params.get("status"));
  const status = parsedStatus.success ? parsedStatus.data : "all";
  const cursor = params.get("cursor")?.slice(0, 512) || undefined;
  const listPage = (pageCursor: string | undefined) =>
    caller.drafts.list({ limit: 25, cursor: pageCursor, q: query, status });
  const [list, totals] = await Promise.all([
    listPage(cursor).catch((error: unknown) => {
      if (cursor && error instanceof ORPCError && error.code === "BAD_REQUEST") {
        return listPage(undefined);
      }
      throw error;
    }),
    caller.drafts.totals(),
  ]);
  const drafts = list.drafts.map((draft) => ({
    ...draft,
    summary: draft.description || draft.repoName || "No description yet",
  }));
  return { session, drafts, totals, nextCursor: list.nextCursor, query, status, paged: !!cursor };
}

export async function loadDraft(request: Request, context: AppRequestContext, draftId: string) {
  const { session, caller } = authenticatedContext(request, context);
  return {
    session,
    ...(await caller.drafts.detail({ draftId })),
    saved: new URL(request.url).searchParams.get("saved") === "1",
  };
}
