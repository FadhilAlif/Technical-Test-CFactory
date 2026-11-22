# ==============================================================================
# CFactory Async Image Processor (CAIP) — Backend API Server (Hono Delegator)
# Multi-stage TypeScript build without `sharp` (BR-06 process isolation)
# ==============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend-api/package.json backend-api/tsconfig.json ./backend-api/
COPY worker/package.json ./worker/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@caip/backend-api --include-workspace-root=false

COPY backend-api/src ./backend-api/src

RUN npm --workspace=@caip/backend-api run typecheck \
 && npm --workspace=@caip/backend-api run build

# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV STORAGE_DIR=/app/storage

COPY package.json package-lock.json ./
COPY backend-api/package.json ./backend-api/
COPY worker/package.json ./worker/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@caip/backend-api --include-workspace-root=false --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && mkdir -p /app/storage/uploads /app/storage/processed \
 && chown -R node:node /app

COPY --from=builder --chown=node:node /app/backend-api/dist ./backend-api/dist

USER node
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend-api/dist/index.js"]
