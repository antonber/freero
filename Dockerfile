# syntax=docker/dockerfile:1.7
# Freero: one image that serves the API, WebSockets, the built web app and the marketing site.
#   docker build -t freero .
#   docker run -p 4000:4000 --env-file .env freero
# Configuration: docs/configuration.md. Deployment: docs/deployment.md.

ARG NODE_IMAGE=node:22-alpine

# ---- 1. all dependencies (to build the web app) ---------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
# No BuildKit cache mounts: hosted builders (Railway) refuse them without their own ids.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- 2. build the SPA -------------------------------------------------------------------------
FROM deps AS web
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Bundle only: types are checked by `npm run check` in CI, not on every image build.
RUN cd apps/web && npx vite build

# ---- 2b. prerender the marketing site (static HTML, OG images; served by modules/site) ------------
FROM deps AS site
COPY tsconfig.base.json ./
COPY apps/web/src/ui/tokens.css apps/web/src/ui/tokens.css
COPY apps/site apps/site
RUN cd apps/site && npx tsx src/build.tsx

# ---- 3. production dependencies of the server only ---------------------------------------------
FROM ${NODE_IMAGE} AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace=@freero/server --include-workspace-root=false

# ---- 4. runtime -------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    FREERO_DATA_DIR=/data \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist apps/web/dist
COPY --from=site /app/apps/site/dist apps/site/dist
# The board outline (modules/outline) reads how each element type reads from the features'
# pure outline.ts files (and the pure helpers they import), discovered at startup.
COPY apps/web/src/features apps/web/src/features
# The public API serves its OpenAPI reference (modules/api) from the checked-in file.
COPY docs/api docs/api
# /data holds only local fallbacks (PGlite without DATABASE_URL, uploads without S3_*); mount a
# volume there only when using them (no VOLUME line: hosts such as Railway refuse it).
# npm/yarn/corepack are not needed at runtime: remove them from the runtime filesystem (attack surface).
RUN mkdir -p /data && chown node:node /data && find apps -name '*.test.ts' -delete \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tsx runs the TypeScript sources directly (the server is never bundled: modules are discovered
# from the file system at startup).
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
