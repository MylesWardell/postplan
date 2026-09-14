import type { ApiKeyAuth, Database } from "@postplan/database";

export interface ApiContext {
  db: Database;
  apiKey: ApiKeyAuth | null;
  session: { accountId: string; accountName: string } | null;
  requestBaseUrl: string;
  publicBaseUrl: string | undefined;
  sourceIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  maxHtmlBytes: number;
  putHtml: (key: string, html: string) => Promise<void>;
  limit: (kind: "upload-ip" | "upload-key" | "key-mint", identity: string) => void;
}
