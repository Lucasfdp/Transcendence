#!/bin/sh
set -eu

VAULT_ENV_FILE="${VAULT_ENV_FILE:-/vault/secrets/backend.env}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"

echo "[backend] Starting Shell Smash backend..."
echo "[backend] Environment: ${NODE_ENV:-production}"

if [ -n "${VAULT_ENV_FILE}" ]; then
    echo "[backend] Waiting for Vault-rendered secrets at ${VAULT_ENV_FILE}..."
    i=0
    until [ -f "${VAULT_ENV_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
        i=$((i + 1))
        sleep 1
    done

    if [ ! -f "${VAULT_ENV_FILE}" ]; then
        echo "[backend] ERROR: Missing Vault secrets file: ${VAULT_ENV_FILE}" >&2
        exit 1
    fi

    set -a
    . "${VAULT_ENV_FILE}"
    set +a
fi

echo "[backend] Waiting for PostgreSQL..."
until nc -z "${POSTGRES_HOST:-database}" "${POSTGRES_PORT:-5432}" 2>/dev/null; do
    sleep 2
done
echo "[backend] Database is reachable."

echo "[backend] Starting server on port ${BACKEND_PORT:-8000}..."
exec "$@"
