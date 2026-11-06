# Prebuilt bases (see Dockerfile.base) hold the slow apt layers.
# Override to build from scratch: --build-arg RUNTIME_BASE=<img> (build Dockerfile.base locally).
ARG BUILD_BASE=ghcr.io/poaudet/graffiti-base:build
ARG RUNTIME_BASE=ghcr.io/poaudet/graffiti-base:runtime

# ── Stage 1: build frontend ─────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: build backend ──────────────────────────────────────
# ubuntu:noble matches the production stage so native modules
# (better-sqlite3) are compiled for the right OS/arch.
FROM ${BUILD_BASE} AS backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npm run build

# ── Stage 3: production ─────────────────────────────────────────
FROM ${RUNTIME_BASE}

WORKDIR /app

# Backend compiled JS + production node_modules (includes native better-sqlite3)
COPY --from=backend /app/package.json ./package.json
COPY --from=backend /app/dist      ./dist
COPY --from=backend /app/node_modules ./node_modules

# Frontend static assets served by the backend in production mode
COPY --from=frontend /app/dist     ./public

ENV NODE_ENV=production \
    PORT=3001 \
    GT_CONFIG_DIR=/config \
    GT_DATA_DIR=/data

# /config  — persisted settings (config.json)
# /data    — persisted database (library.db)
# /music   — bind-mount your music library here
# /inbox   — bind-mount your staging folder here
VOLUME ["/config", "/data", "/music", "/inbox"]

EXPOSE 3001

CMD ["node", "dist/server.js"]
