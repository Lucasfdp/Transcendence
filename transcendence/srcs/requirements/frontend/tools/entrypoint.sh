#!/bin/sh
# ==============================================================================
# ft_transcendence — Frontend Entrypoint Script
# ==============================================================================

set -e

echo "[frontend] Starting frontend service..."
echo "[frontend] Environment: ${NODE_ENV:-production}"

# --------------------------------------------------------------------------
# Development mode: start dev server with hot module replacement
# --------------------------------------------------------------------------
# if [ "$NODE_ENV" = "development" ]; then
#   echo "[frontend] Starting Vite dev server..."
#   exec npm run dev -- --host 0.0.0.0 --port 3000
# fi

# --------------------------------------------------------------------------
# Production mode: serve compiled static files
# --------------------------------------------------------------------------
# Option A: serve with 'serve' package
#   exec npx serve -s dist -l 3000
#
# Option B: Nginx in the container (separate from the reverse proxy)
#   exec nginx -g "daemon off;"
#
# Option C: Let the reverse proxy (Nginx) serve from the shared volume —
#   in this case the frontend container can be a no-op after copying files.
# --------------------------------------------------------------------------

echo "[frontend] Frontend placeholder running on port 3000..."

# Placeholder — replace with real command
exec sh -c "while true; do echo '[frontend] placeholder running...'; sleep 30; done"
