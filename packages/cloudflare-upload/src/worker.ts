import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { directUpload } from "./direct";
import { errorResponse, notFound } from "./http";
const app = new Hono<{ Bindings: Bindings }>();
app.post("/api/uploads", (c) => directUpload(c.req.raw, c.env));
app.notFound(notFound);
app.onError(errorResponse);
export default app;
