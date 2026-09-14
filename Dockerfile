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
COPY packages/store/package.json ./packages/store/package.json
COPY packages/store-drizzle/package.json ./packages/store-drizzle/package.json
COPY packages/store-dynamodb/package.json ./packages/store-dynamodb/package.json
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM bun AS app-base
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/postplan.sqlite
COPY --from=dependencies /app /app
COPY --from=build /workspace/apps/server/dist ./apps/server/dist
COPY --from=build /workspace/packages/store-drizzle/drizzle ./packages/store-drizzle/drizzle
COPY --from=build /workspace/packages/api/dist/src ./packages/api/dist/src
COPY --from=build /workspace/packages/store/dist/src ./packages/store/dist/src
COPY --from=build /workspace/packages/store-drizzle/dist/src ./packages/store-drizzle/dist/src
COPY --from=build /workspace/packages/store-dynamodb/dist/src ./packages/store-dynamodb/dist/src
RUN mkdir /data && chown bun:bun /data
RUN bun -e "await import('./apps/server/dist/src/index.js')"
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/dist/src/launch.js"]

FROM app-base AS lambda-app
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=3000 AWS_LWA_READINESS_CHECK_PATH=/healthz AWS_LWA_INVOKE_MODE=buffered

FROM app-base AS lambda-cleanup
CMD ["bun", "apps/server/dist/src/cleanup.js"]

FROM app-base AS runtime
