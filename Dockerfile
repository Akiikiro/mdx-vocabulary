# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS backend-build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# msedge-tts declares a pnpm-only preinstall guard. The application uses npm,
# and none of the backend runtime dependencies require lifecycle scripts here.
RUN npm ci --ignore-scripts

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build:server && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    APP_DATA_DIR=/app/data \
    WEB_DIST_DIR=/app/web-dist

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=backend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/prisma ./prisma
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --from=web-build --chown=node:node /app/web/dist ./web-dist

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/api.js"]
