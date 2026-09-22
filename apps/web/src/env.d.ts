import type { AppRequestContext } from "./frontend/context.server";

declare global {
  namespace App {
    interface Locals extends AppRequestContext {}
  }
}
