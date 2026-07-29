# Build stage — needs a toolchain because better-sqlite3 is a native module and
# has no prebuilt binary for every Node/arch combination (notably ARM64, which is
# what the Oracle Ampere A1 shapes are).
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/ ./
RUN npm run build \
  && npm prune --omit=dev

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/server.ts /app/package.json ./

# First-run seed reads ../../invoices_2026.csv relative to server/, which resolves
# to /invoices_2026.csv from /app/server. Without it the app still starts, just
# with no imported invoice history.
COPY invoices_2026.csv /invoices_2026.csv

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "server.ts"]
