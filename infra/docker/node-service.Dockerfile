# syntax=docker/dockerfile:1.7
# Generic image for KAREN Node services (api, temporal-worker, provider-worker).
#   docker build -f infra/docker/node-service.Dockerfile --build-arg APP=api -t karen/api:dev .
ARG NODE_IMAGE=node:24.11.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG APP
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@karen/${APP}...
# Self-contained production node_modules for just this app (workspace deps packed in).
RUN pnpm --filter @karen/${APP} deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ARG APP
# api=4100, provider-worker=4200, temporal-worker=4300
ARG HEALTH_PORT=4100
# KAREN_DEPLOYED_ARTIFACT makes config refuse an implicit APP_ENV (fail closed, ADR-0013).
ENV NODE_ENV=production HEALTH_PORT=${HEALTH_PORT} KAREN_DEPLOYED_ARTIFACT=true
WORKDIR /app
# uid/gid 1000 ("node") matches the ECS task definition; root filesystem can be read-only.
COPY --from=build --chown=1000:1000 /out /app
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const p=process.env.HEALTH_PORT;fetch('http://127.0.0.1:'+p+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
