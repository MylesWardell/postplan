const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;

export interface DraftUrlOptions {
  draftId: string;
  publicBaseUrl?: string;
  requestBaseUrl: string;
}

export function getRequestBaseUrl(req: Request): string {
  return new URL(req.url).origin;
}

export function getHomeUrl({
  publicBaseUrl,
  requestBaseUrl,
}: {
  publicBaseUrl?: string;
  requestBaseUrl: string;
}): string {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  return configured || normalizeUrl(requestBaseUrl);
}

export function getDraftPublicUrl({
  draftId,
  publicBaseUrl,
  requestBaseUrl,
}: DraftUrlOptions): string {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = `${draftId}.${wildcard.hostname.slice(2)}`;
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}`;
}

export function getDraftRawUrl({
  draftId,
  publicBaseUrl,
  requestBaseUrl,
}: DraftUrlOptions): string {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = `/d/${draftId}/raw`;
    wildcard.search = "";
    wildcard.hash = "";
    return wildcard.toString();
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}/raw`;
}

const URL_SAFE_DRAFT_ID = /^[a-z0-9]+$/;
const DRAFT_ID_MARKER = "postplan0draft0id0marker";

// Builds public and raw URLs for many drafts while parsing the base URL once. Generated ids are
// lowercase alphanumeric, which URL serialization leaves unchanged; any other id takes the
// per-draft URL path so the output always matches getDraftPublicUrl/getDraftRawUrl.
export function draftUrlBuilder({
  publicBaseUrl,
  requestBaseUrl,
}: Omit<DraftUrlOptions, "draftId">): (draftId: string) => { publicUrl: string; rawUrl: string } {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);
  const exact = (draftId: string) => ({
    publicUrl: getDraftPublicUrl({ draftId, publicBaseUrl, requestBaseUrl }),
    rawUrl: getDraftRawUrl({ draftId, publicBaseUrl, requestBaseUrl }),
  });
  if (!wildcard) {
    const baseUrl = configured || normalizeUrl(requestBaseUrl);
    return (draftId) => ({
      publicUrl: `${baseUrl}/d/${draftId}`,
      rawUrl: `${baseUrl}/d/${draftId}/raw`,
    });
  }
  const root = wildcard.hostname.slice(2);
  wildcard.search = "";
  wildcard.hash = "";
  wildcard.hostname = `${DRAFT_ID_MARKER}.${root}`;
  wildcard.pathname = "/";
  const [publicPrefix, publicSuffix, ...extra] = stripTrailingSlash(wildcard.toString()).split(
    DRAFT_ID_MARKER,
  );
  wildcard.hostname = root;
  wildcard.pathname = "/d/";
  const rawPrefix = wildcard.toString();
  if (extra.length || publicSuffix === undefined || !rawPrefix.endsWith("/d/")) {
    return exact;
  }
  return (draftId) =>
    URL_SAFE_DRAFT_ID.test(draftId)
      ? { publicUrl: publicPrefix + draftId + publicSuffix, rawUrl: `${rawPrefix}${draftId}/raw` }
      : exact(draftId);
}

export function getDraftIdFromHost({
  publicBaseUrl,
  host,
}: {
  publicBaseUrl?: string;
  host: string | undefined;
}): string | null {
  const wildcard = parseWildcardBaseUrl(publicBaseUrl);
  if (!wildcard) {
    return null;
  }

  const rootHost = wildcard.hostname.slice(2).toLowerCase();
  const requestHost = parseHost(host);
  if (!requestHost || !requestHost.endsWith(`.${rootHost}`)) {
    return null;
  }

  const draftId = requestHost.slice(0, -(rootHost.length + 1));
  if (draftId.includes(".") || !DRAFT_ID_PATTERN.test(draftId)) {
    return null;
  }
  return draftId;
}

function parseWildcardBaseUrl(value: string | undefined): URL | null {
  const url = parseUrl(value);
  if (!url || !url.hostname.startsWith("*.")) {
    return null;
  }
  return url;
}

function parseHost(value: string | undefined): string | null {
  const normalized = (value || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(`http://${normalized}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseUrl(value: string | undefined): URL | null {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function normalizeUrl(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\/+$/, "");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
