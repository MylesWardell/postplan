import { createServerOptions as bunOptions } from "#index";
import { config } from "#config";
import type { ServerDependencies } from "#context";
import type * as ServerModule from "#server";

// Exercise Start's transformed production routes and server functions, not uncompiled source.
const entry = new URL("../dist/server/server.js", import.meta.url).href;
const start: typeof ServerModule = await import(entry);

export function createServerOptions(deps: ServerDependencies) {
  return bunOptions(
    deps,
    {
      createApplication(dependencies) {
        Object.assign(start.config, config);
        const fetch = start.createApplication(dependencies);
        return (request, peerIp) => {
          // The Vite bundle owns a separate instance of the mutable test configuration.
          Object.assign(start.config, config);
          return fetch(request, peerIp);
        };
      },
    },
    new URL("../dist/client/", import.meta.url),
  );
}
