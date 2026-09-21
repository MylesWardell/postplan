import { createApp } from "astro/app/entrypoint";
import type { AppRequestContext } from "./frontend/context.server";

const app = createApp({ streaming: false });
export const renderFrontend = (request: Request, context: AppRequestContext) =>
  app.render(request, { locals: context });
