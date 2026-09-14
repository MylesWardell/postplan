// Shared by the server-rendered pages (render.ts, render-web.ts), which each
// carried an identical copy before the TypeScript conversion.
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
