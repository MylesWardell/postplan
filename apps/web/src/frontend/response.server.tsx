import { createElement, type ReactNode } from "react";
import { Document, Layout } from "./layout";
import { renderToStaticMarkup } from "react-dom/server";

export function page(element: ReactNode, status = 200): Response {
  return htmlResponse(renderToStaticMarkup(createElement(Document, { children: element })), status);
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response("<!doctype html>" + html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; img-src https: data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

export function messageResponse(title: string, message: string, status: number): Response {
  return page(
    <Layout title={title}>
      <section className="narrow panel pad">
        <p className="eyebrow">Postplan</p>
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        <a className="button secondary" href="/dashboard">
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
