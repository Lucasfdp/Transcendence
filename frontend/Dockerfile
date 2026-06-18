# ==============================================================================
# Shell Smash — Frontend Service (Phaser.js + Vite)
# ==============================================================================
FROM node:20-alpine AS builder
LABEL stage="builder"
ARG FRONTEND_ENV=production
ARG VITE_API_URL=/api
ARG VITE_GITHUB_AUTH_URL=
ENV NODE_ENV=${FRONTEND_ENV}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GITHUB_AUTH_URL=${VITE_GITHUB_AUTH_URL}
WORKDIR /app/frontend
COPY frontend/package.json ./
# Intentionally omit package-lock.json: npm ci uses the lockfile's resolved
# optional-dependency URLs, which are arch-specific.  Copying a lockfile built
# on macOS arm64 into a linux/arm64 musl container causes rollup's native
# binding (@rollup/rollup-linux-arm64-musl) to go missing (npm/cli#4828).
# npm install re-resolves optionalDependencies for the current platform.
RUN npm install
COPY frontend/ ./
COPY public /app/public
RUN npm run build

FROM node:20-alpine
LABEL maintainer="Shell Smash"
LABEL description="Phaser.js + Vite frontend for the Shell Smash gaming hub"
ARG FRONTEND_ENV=production
ENV NODE_ENV=${FRONTEND_ENV}
RUN apk update && apk add --no-cache wget curl && rm -rf /var/cache/apk/* \
    && npm install -g serve \
    && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
RUN chown -R appuser:appgroup /app
COPY frontend/tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
