#!/bin/sh
set -eu

BASE_REDIS_CONF=/etc/redis/redis.conf
RUNTIME_REDIS_CONF=/tmp/redis-runtime.conf
REDIS_PASSWORD_FILE="${REDIS_PASSWORD_FILE:-/vault/secrets/redis_password}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"

echo "[redis] Configuring Redis..."
cp "${BASE_REDIS_CONF}" "${RUNTIME_REDIS_CONF}"

i=0
until [ -s "${REDIS_PASSWORD_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
    i=$((i + 1))
    sleep 1
done

if [ ! -s "${REDIS_PASSWORD_FILE}" ]; then
    echo "[redis] ERROR: Missing Vault password file: ${REDIS_PASSWORD_FILE}" >&2
    exit 1
fi

REDIS_PASSWORD="$(cat "${REDIS_PASSWORD_FILE}")"

if [ -n "${REDIS_PASSWORD}" ]; then
    echo "requirepass ${REDIS_PASSWORD}" >> "${RUNTIME_REDIS_CONF}"
    echo "[redis] Password authentication enabled."
else
    echo "[redis] ERROR: Vault rendered an empty Redis password." >&2
    exit 1
fi

if [ -n "${REDIS_MAX_MEMORY:-}" ]; then
    echo "maxmemory ${REDIS_MAX_MEMORY}" >> "${RUNTIME_REDIS_CONF}"
fi

if [ -n "${REDIS_MAX_MEMORY_POLICY:-}" ]; then
    echo "maxmemory-policy ${REDIS_MAX_MEMORY_POLICY}" >> "${RUNTIME_REDIS_CONF}"
fi

echo "[redis] Starting Redis server..."
exec redis-server "${RUNTIME_REDIS_CONF}"
