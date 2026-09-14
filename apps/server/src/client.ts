import { createRouterClient } from "@orpc/server";
import type { BaseContext } from "./context.js";
import { router } from "./routers/index.js";

export const createCaller = (context: BaseContext) => createRouterClient(router, { context });
