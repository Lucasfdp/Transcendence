# ==============================================================================
# ft_transcendence — Frontend Service
# ==============================================================================
# PLACEHOLDER — Replace this Dockerfile with your chosen framework:
#
#   React (Vite)  → node:20-alpine, npm install, npm run build → /app/dist
#   Vue 3         → node:20-alpine, npm install, npm run build → /app/dist
#   Angular       → node:20-alpine, npm install, npm run build → /app/dist
#   Svelte        → node:20-alpine, npm install, npm run build → /app/dist
#   Vanilla JS    → no builder needed; copy static files directly
#
# The multi-stage build keeps the final image small:
#   Stage 1 (builder): Install node_modules and compile the SPA
#   Stage 2 (runtime): Copy only the /dist output, no node_modules
# ==============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

LABEL stage="builder"

ARG FRONTEND_ENV=production
ARG VITE_API_URL=https://localhost/api
ENV NODE_ENV=${FRONTEND_ENV}
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app

# Uncomment when adding your framework:
# COPY package.json package-lock.json ./
# RUN npm ci --only=production
# COPY . .
# RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="ft_transcendence"
LABEL description="Frontend SPA service (framework TBD)"

ARG FRONTEND_ENV=production
ENV NODE_ENV=${FRONTEND_ENV}

RUN apk update && apk add --no-cache wget curl && rm -rf /var/cache/apk/*

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Uncomment when adding your framework:
# COPY --from=builder /app/dist /app/dist

COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && chown -R appuser:appgroup /app

# Health flag file used by the placeholder healthcheck
RUN touch /tmp/healthy && chown appuser:appgroup /tmp/healthy

USER appuser

EXPOSE 3000

# --------------------------------------------------------------------------
# Healthcheck — placeholder mode
# --------------------------------------------------------------------------
# Verifies the process is alive via a flag file.
# Once your framework is running, replace with:
#   CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
# --------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD test -f /tmp/healthy || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
