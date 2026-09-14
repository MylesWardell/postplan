import { findPublicDraftVersion } from "#routers/draft-store";
import type { ServerDependencies } from "#context";

export async function draftResponse(
  req: Request,
  deps: ServerDependencies,
  hostDraftId: string | null,
): Promise<Response | undefined> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return;
  }
  const path = new URL(req.url).pathname;
  const match = hostDraftId
    ? path.match(/^\/(?:v\/([^/]+))?(?:\/?raw)?\/?$/)
    : path.match(/^\/d\/([^/]+)(?:\/v\/([^/]+))?(?:\/raw)?\/?$/);
  if (!match) {
    return;
  }
  const draftId = hostDraftId ?? match[1]!;
  const number = hostDraftId ? match[1] : match[2];
  const versionNumber = number === undefined ? undefined : Number(number);
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    return;
  }
  const { draft, version } = await findPublicDraftVersion(deps.db, draftId, versionNumber);
  if (!draft || !version) {
    return;
  }
  return new Response(req.method === "HEAD" ? null : await deps.getHtml(version.objectKey), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
      "X-Postplan-Draft-Id": draft.id,
      "X-Postplan-Draft-Version": String(version.versionNumber),
    },
  });
}
