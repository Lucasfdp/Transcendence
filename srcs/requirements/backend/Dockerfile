# ==============================================================================
# Shell Smash — Backend Service (NestJS)
# ==============================================================================
FROM node:20-alpine AS builder
LABEL stage="builder"
ARG BACKEND_ENV=production
ENV NODE_ENV=${BACKEND_ENV}
WORKDIR /build
COPY src/package.json ./
COPY src/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY src/ .
RUN npm run build

FROM node:20-alpine
LABEL maintainer="Shell Smash"
LABEL description="NestJS backend API for the Shell Smash gaming hub"
ARG BACKEND_ENV=production
ENV NODE_ENV=${BACKEND_ENV}
RUN apk update && apk add --no-cache wget curl ca-certificates netcat-openbsd && rm -rf /var/cache/apk/*
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./
RUN chown -R appuser:appgroup /app
COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD wget --quiet --tries=1 --spider http://localhost:8000/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
