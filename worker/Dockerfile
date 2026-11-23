# ==============================================================================
# CFactory Async Image Processor (CAIP) — Background Worker (BullMQ + Sharp)
# Uses Debian slim for native libvips/Sharp binary stability & SIGTERM shutdown
# ==============================================================================

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend-api/package.json ./backend-api/
COPY worker/package.json worker/tsconfig.json ./worker/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@caip/worker --include-workspace-root=false

COPY worker/src ./worker/src

RUN npm --workspace=@caip/worker run typecheck \
 && npm --workspace=@caip/worker run build

# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage

COPY package.json package-lock.json ./
COPY backend-api/package.json ./backend-api/
COPY worker/package.json ./worker/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@caip/worker --include-workspace-root=false --omit=dev \
 && npm cache clean --force \
 && mkdir -p /app/storage/uploads /app/storage/processed \
 && chown -R node:node /app

COPY --from=builder --chown=node:node /app/worker/dist ./worker/dist

USER node
STOPSIGNAL SIGTERM

CMD ["node", "worker/dist/index.js"]
