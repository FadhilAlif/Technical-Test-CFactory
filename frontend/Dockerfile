# ==============================================================================
# CFactory Async Image Processor (CAIP) — Next.js App Router Frontend
# Multi-stage standalone build
# ==============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ARG NEXT_PUBLIC_MAX_FILE_SIZE_MB=20

ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_MAX_FILE_SIZE_MB=$NEXT_PUBLIC_MAX_FILE_SIZE_MB
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY backend-api/package.json ./backend-api/
COPY worker/package.json ./worker/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@caip/frontend --include-workspace-root=false

COPY frontend ./frontend

RUN npm --workspace=@caip/frontend run typecheck \
 && npm --workspace=@caip/frontend run build

# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/frontend/.next/standalone ./
COPY --from=builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "frontend/server.js"]
