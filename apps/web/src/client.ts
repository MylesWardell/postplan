import { createRouterClient } from "@orpc/server";
import type { BaseContext } from "./context";
import { router } from "#routers/index";

export const createCaller = (context: BaseContext) => createRouterClient(router, { context });
