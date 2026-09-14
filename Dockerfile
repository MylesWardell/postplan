FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.22.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm check
RUN pnpm --filter @postplan/server deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && mkdir -p /app/certs \
    && curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
RUN node --input-type=module -e "await import('./dist/src/app.js')"
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/src/server.js"]
