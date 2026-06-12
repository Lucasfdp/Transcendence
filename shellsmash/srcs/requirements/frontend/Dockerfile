# ==============================================================================
# Shell Smash — Frontend Service (Phaser.js + Vite)
# ==============================================================================
FROM node:20-alpine AS builder
LABEL stage="builder"
ARG FRONTEND_ENV=production
ARG VITE_API_URL=https://localhost/api
ENV NODE_ENV=${FRONTEND_ENV}
ENV VITE_API_URL=${VITE_API_URL}
WORKDIR /app
COPY src/package.json ./
COPY src/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY src/ .
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
COPY --from=builder /app/dist ./dist
RUN chown -R appuser:appgroup /app
COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
