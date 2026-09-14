FROM oven/bun:1.3.14-debian AS bun
FROM node:22-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workspace
COPY . .
RUN bun install --frozen-lockfile
RUN bun run check

FROM bun AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY packages/api/package.json ./packages/api/package.json
RUN bun install --production --frozen-lockfile

FROM bun AS runtime
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/postplan.sqlite
COPY --from=dependencies /app /app
COPY --from=build /workspace/apps/server/dist ./apps/server/dist
COPY --from=build /workspace/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /workspace/packages/api/dist/src ./packages/api/dist/src
RUN mkdir /data && chown bun:bun /data
RUN bun -e "await import('./apps/server/dist/src/index.js')"
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/dist/src/index.js"]
