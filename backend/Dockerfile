# ==============================================================================
# Shell Smash — Backend Service (NestJS)
# ==============================================================================
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS deps
LABEL stage="deps"
WORKDIR /build
COPY package.json ./
COPY package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS builder
LABEL stage="builder"
ARG BACKEND_ENV=production
ENV NODE_ENV=${BACKEND_ENV}
WORKDIR /build
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS prod-deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
LABEL maintainer="Shell Smash"
LABEL description="NestJS backend API for the Shell Smash gaming hub"
ARG BACKEND_ENV=production
ENV NODE_ENV=${BACKEND_ENV}
RUN apk update && apk add --no-cache wget curl ca-certificates netcat-openbsd && rm -rf /var/cache/apk/* \
    && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
RUN mkdir -p /app/uploads/avatars \
    && chown -R appuser:appgroup /app/uploads
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /build/dist ./dist
COPY --from=builder --chown=appuser:appgroup /build/package.json ./
COPY --chown=appuser:appgroup tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD wget --quiet --tries=1 --spider http://localhost:8000/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
