import { createRouterClient } from "@orpc/server";

import { router } from "#routers/index";

import type { BaseContext } from "./context";

export const createCaller = (context: BaseContext) => createRouterClient(router, { context });
