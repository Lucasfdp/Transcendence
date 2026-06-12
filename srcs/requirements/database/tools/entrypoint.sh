#!/bin/sh
# ==============================================================================
# ft_transcendence — Database Custom Entrypoint
# ==============================================================================
# This script wraps the official postgres entrypoint.
# Add any pre-start validation or configuration here.
#
# Note: Actual database initialisation (CREATE TABLE, etc.) should be placed
# in SQL files under /docker-entrypoint-initdb.d/ — not here.
# ==============================================================================

set -e

echo "[database] Starting PostgreSQL..."
echo "[database] Database: ${POSTGRES_DB}"
echo "[database] User:     ${POSTGRES_USER}"

# Validate required environment variables
if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "[database] ERROR: POSTGRES_PASSWORD is not set. Refusing to start."
    exit 1
fi

# Delegate to the official PostgreSQL entrypoint
exec docker-entrypoint.sh "$@"
