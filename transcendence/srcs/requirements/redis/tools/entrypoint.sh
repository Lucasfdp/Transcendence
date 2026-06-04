#!/bin/sh
# ==============================================================================
# ft_transcendence — Redis Entrypoint
# ==============================================================================
# Dynamically writes runtime configuration values into redis.conf
# before starting the Redis server.
# ==============================================================================

set -e

REDIS_CONF=/etc/redis/redis.conf

echo "[redis] Configuring Redis..."

# Inject password from environment variable
if [ -n "$REDIS_PASSWORD" ]; then
    echo "requirepass ${REDIS_PASSWORD}" >> "$REDIS_CONF"
    echo "[redis] Password authentication enabled."
else
    echo "[redis] WARNING: No REDIS_PASSWORD set. Running without authentication."
fi

# Inject maxmemory
if [ -n "$REDIS_MAX_MEMORY" ]; then
    echo "maxmemory ${REDIS_MAX_MEMORY}" >> "$REDIS_CONF"
fi

# Inject maxmemory-policy
if [ -n "$REDIS_MAX_MEMORY_POLICY" ]; then
    echo "maxmemory-policy ${REDIS_MAX_MEMORY_POLICY}" >> "$REDIS_CONF"
fi

echo "[redis] Starting Redis server..."
exec redis-server "$REDIS_CONF"
