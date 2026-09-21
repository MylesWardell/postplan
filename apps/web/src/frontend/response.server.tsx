import type { Child } from "hono/jsx";
import { renderToString } from "hono/jsx/dom/server";
import { Layout } from "./layout";

export function page(element: Child, status = 200): Response {
  return htmlResponse(renderToString(element), status);
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response("<!doctype html>" + html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'none'; style-src 'self'; img-src https: data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
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
