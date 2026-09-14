import { createRouterClient } from "@orpc/server";
import type { ApiContext } from "./context.js";
import { router } from "./routers/index.js";

export const createCaller = (context: ApiContext) =>
  createRouterClient(router, { context: { resolveContext: async () => context } });
