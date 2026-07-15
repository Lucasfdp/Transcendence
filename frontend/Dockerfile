# ==============================================================================
# Shell Smash — Frontend Service (Phaser.js + Vite)
# ==============================================================================
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
LABEL stage="builder"
ARG FRONTEND_ENV=production
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
WORKDIR /app/frontend
COPY frontend/package.json ./
COPY frontend/package-lock.json* ./
COPY frontend/scripts/apply-phaser-webgl-patch.mjs ./scripts/apply-phaser-webgl-patch.mjs
# Keep `npm install` here instead of `npm ci`: Vite/Rollup's optional native
# packages can differ by platform, and `npm install` re-resolves them inside the
# target container environment. The build stage must keep devDependencies
# available even when the final runtime image uses production settings.
RUN --mount=type=cache,target=/root/.npm npm install
COPY frontend/ ./
COPY public /app/public
RUN npm run build

FROM nginx:1.27-alpine
LABEL maintainer="Shell Smash"
LABEL description="Phaser.js + Vite frontend for the Shell Smash gaming hub"
ARG FRONTEND_ENV=production
ENV NODE_ENV=${FRONTEND_ENV}
RUN apk add --no-cache wget
COPY frontend/conf/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
