# Build context is the repo root: docker buildx build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

# Install first (cached until a manifest or the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter 'api...'

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter api build
# Production node_modules only (better-sqlite3 ships prebuilt binaries inside its package).
RUN pnpm --filter api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist

# Fails the build unless better-sqlite3 loads its prebuilt binary. This stage has no
# compiler toolchain, so a source build could never have produced one.
RUN node -e "new (require('better-sqlite3'))(':memory:').close(); console.log('better-sqlite3: prebuilt binary OK')"

RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
