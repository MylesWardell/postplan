import { createStart } from "@tanstack/react-start";
import { contentSecurityPolicy, csrfProtection, requestContext } from "./middleware/request.js";

export const startInstance = createStart(() => ({
  requestMiddleware: [requestContext, contentSecurityPolicy, csrfProtection],
}));
