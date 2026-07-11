#!/bin/sh
set -eu

# ------------------------------------------------------------------------------
# Loads REDIS_PASSWORD from a Vault-rendered secret file instead of a compose
# environment literal (never hardcode credentials). The redis service's own
# Vault agent renders this file into the shared, read-only
# redis_vault_rendered volume.
# ------------------------------------------------------------------------------
REDIS_PASSWORD_FILE="${REDIS_PASSWORD_FILE:-/vault/secrets/redis_password}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"

echo "[redis-exporter] Waiting for Redis credential..."

i=0
until [ -s "${REDIS_PASSWORD_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
  i=$((i + 1))
  sleep 1
done

if [ ! -s "${REDIS_PASSWORD_FILE}" ]; then
  echo "[redis-exporter] ERROR: Missing Vault secret file: ${REDIS_PASSWORD_FILE}" >&2
  exit 1
fi

export REDIS_PASSWORD="$(cat "${REDIS_PASSWORD_FILE}")"
export REDIS_ADDR="${REDIS_ADDR:-redis://redis:6379}"

echo "[redis-exporter] Starting redis_exporter (addr=${REDIS_ADDR})..."
exec /usr/local/bin/redis_exporter "$@"
