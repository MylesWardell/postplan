import { Hono } from "hono";
import { FetchState, actions, middleware, pages } from "astro/hono";

const app = new Hono<{ Variables: { fetchState: FetchState } }>();
app.use(async (c, next) => {
  const state = new FetchState(c.req.raw);
  c.set("fetchState", state);
  // Astro's Bun dev server enters here before the production host has attached locals.
  if (import.meta.env.DEV && import.meta.env.POSTPLAN_BUN && !state.locals.deps) {
    const { default: server } = await import("./server");
    return server.fetch(c.req.raw);
  }
  await next();
  return c.res;
});
app.use(actions());
app.use(middleware());
app.use(pages());
export default app;
