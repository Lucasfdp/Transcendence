#!/bin/sh
set -e
echo "[backend] Starting Shell Smash backend..."
echo "[backend] Environment: ${NODE_ENV:-production}"

echo "[backend] Waiting for PostgreSQL..."
until nc -z "${POSTGRES_HOST:-database}" "${POSTGRES_PORT:-5432}" 2>/dev/null; do
    sleep 2
done
echo "[backend] Database is reachable."

echo "[backend] Starting server on port ${BACKEND_PORT:-8000}..."
exec node dist/main.js
