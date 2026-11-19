# syntax=docker/dockerfile:1.7
# Next.js standalone image for apps/web and apps/admin.
#   docker build -f infra/docker/nextjs.Dockerfile --build-arg APP=web -t karen/web:dev .
# NEXT_PUBLIC_* values are inlined at BUILD time — pass them as build args, never secrets.
ARG NODE_IMAGE=node:24.11.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG APP
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_API_BASE_URL
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@karen/${APP}...

FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=1000:1000 /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=1000:1000 /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER 1000:1000
ENV APP_DIR=apps/${APP}
EXPOSE 3000
CMD ["sh", "-c", "node $APP_DIR/server.js"]
