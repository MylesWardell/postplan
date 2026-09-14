import { createMiddleware } from "@tanstack/react-start";
import { notFoundResponse } from "./response.server";

export const getOnly = createMiddleware().server(({ request, next }) =>
  request.method === "GET" || request.method === "HEAD" ? next() : notFoundResponse(),
);
export const postOnly = createMiddleware().server(({ request, next }) =>
  request.method === "POST" ? next() : notFoundResponse(),
);
