#!/bin/sh
set -eu

POSTGRES_PASSWORD_FILE="${POSTGRES_PASSWORD_FILE:-/vault/secrets/postgres_password}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"

echo "[database] Starting PostgreSQL..."
echo "[database] Database: ${POSTGRES_DB}"
echo "[database] User:     ${POSTGRES_USER}"

i=0
until [ -s "${POSTGRES_PASSWORD_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
    i=$((i + 1))
    sleep 1
done

if [ ! -s "${POSTGRES_PASSWORD_FILE}" ]; then
    echo "[database] ERROR: Missing Vault password file: ${POSTGRES_PASSWORD_FILE}" >&2
    exit 1
fi

export POSTGRES_PASSWORD_FILE
exec docker-entrypoint.sh "$@"
