# ==============================================================================
# ft_transcendence — Backend Service
# ==============================================================================
# PLACEHOLDER — Replace this Dockerfile with your chosen framework:
#
#   Python / Django   → use python:3.12-alpine, install via pip
#   Python / FastAPI  → use python:3.12-alpine, install via pip
#   Node   / Express  → use node:20-alpine
#   Node   / NestJS   → use node:20-alpine
#   Java   / Spring   → use eclipse-temurin:21-jre-alpine
#   Go                → see multi-stage example below
#
# This file shows a multi-stage build pattern that works for most compiled or
# dependency-heavy runtimes. Adapt stage names and commands to your stack.
#
# Key practices demonstrated:
#   1. Multi-stage build (keeps final image small)
#   2. Non-root user (security hardening)
#   3. Healthcheck endpoint (/health)
#   4. Build-arg for environment (development vs production)
# ==============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Install dependencies and build artefacts in a full image.
# Only the compiled output is copied to the final stage.
# ------------------------------------------------------------------------------
FROM alpine:3.19 AS builder

LABEL stage="builder"

# Install build dependencies (customise for your stack)
# Examples:
#   Python:  python3 py3-pip python3-dev build-base
#   Node:    nodejs npm
#   Go:      go
#   Java:    openjdk21-jdk maven
RUN apk update && apk add --no-cache \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /build

# Copy dependency manifests first for better layer caching.
# Replace with the correct file for your stack:
#   Python:  requirements.txt or pyproject.toml
#   Node:    package.json package-lock.json (or yarn.lock)
#   Go:      go.mod go.sum
#   Java:    pom.xml
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
# COPY . .

# Run build step if applicable (compile, transpile, generate static files, etc.)
# Examples:
#   Django:  python manage.py collectstatic --noinput
#   NestJS:  npm run build
#   Go:      go build -o /build/app ./cmd/server
#   Spring:  mvn package -DskipTests

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Minimal runtime image — no compilers, no package managers.
# ------------------------------------------------------------------------------
FROM alpine:3.19

LABEL maintainer="ft_transcendence"
LABEL description="Backend API service (framework TBD)"

ARG BACKEND_ENV=production
ENV APP_ENV=${BACKEND_ENV}

# Install runtime dependencies only (no dev tools)
# Examples:
#   Python:  python3 libpq (for psycopg2)
#   Node:    nodejs
#   Go:      ca-certificates (usually nothing else)
#   Java:    openjdk21-jre-headless
RUN apk update && apk add --no-cache \
    wget \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# --------------------------------------------------------------------------
# Non-root user
# --------------------------------------------------------------------------
# Running as root inside a container is a security risk.
# If the container is compromised, root access to the container file system
# could be leveraged to escape the container in certain configurations.
# --------------------------------------------------------------------------
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy built artefacts from the builder stage
# COPY --from=builder /build/dist /app/dist
# COPY --from=builder /build/app  /app/app

# Placeholder entrypoint — replace with your actual start command:
#   Django:  ["python", "manage.py", "runserver", "0.0.0.0:8000"]
#   FastAPI: ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
#   Express: ["node", "dist/index.js"]
#   NestJS:  ["node", "dist/main.js"]
#   Go:      ["/app/app"]
COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && chown appuser:appgroup /usr/local/bin/entrypoint.sh

# Switch to non-root user BEFORE running the application
USER appuser

EXPOSE 8000

# --------------------------------------------------------------------------
# Healthcheck
# --------------------------------------------------------------------------
# The /health endpoint must return HTTP 200.
# Implement this endpoint in your chosen framework before wiring it up.
# --------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD wget --quiet --tries=1 --spider http://localhost:8000/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
