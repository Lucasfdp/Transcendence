#!/bin/sh
# ==============================================================================
# ft_transcendence — Backend Entrypoint Script
# ==============================================================================
# This script runs inside the container before the main process starts.
# Use it for pre-startup tasks:
#   - Wait for dependent services (database, redis)
#   - Run database migrations
#   - Seed initial data
#   - Validate environment variables
# ==============================================================================

set -e

echo "[backend] Starting backend service..."
echo "[backend] Environment: ${APP_ENV:-production}"

# --------------------------------------------------------------------------
# Wait for the database to be ready
# --------------------------------------------------------------------------
# Replace with your actual DB connection check.
# Example using pg_isready (requires postgresql-client in the image):
#
# until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER"; do
#   echo "[backend] Waiting for database..."
#   sleep 2
# done
# echo "[backend] Database is ready."
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Run database migrations (framework-specific)
# --------------------------------------------------------------------------
# Django:   python manage.py migrate
# Alembic:  alembic upgrade head
# Flyway:   flyway migrate
# Liquibase:liquibase update
# Prisma:   npx prisma migrate deploy
# --------------------------------------------------------------------------
# echo "[backend] Running migrations..."
# python manage.py migrate

# --------------------------------------------------------------------------
# Start the application server
# --------------------------------------------------------------------------
# Replace the exec command with your framework's production server:
#
#   Django (Gunicorn):  exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4
#   FastAPI (Uvicorn):  exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
#   Express:            exec node dist/index.js
#   NestJS:             exec node dist/main.js
#   Go binary:          exec /app/app
# --------------------------------------------------------------------------

echo "[backend] Starting server on port ${BACKEND_PORT:-8000}..."

# Placeholder — replace with real command
exec sh -c "while true; do echo '[backend] placeholder running...'; sleep 30; done"
