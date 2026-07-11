#!/bin/sh
set -eu

# ------------------------------------------------------------------------------
# Assembles DATA_SOURCE_NAME for postgres_exporter from a Vault-rendered
# secret file instead of a compose environment literal (never hardcode
# credentials). The database service's own Vault agent renders this file
# into the shared, read-only database_vault_rendered volume.
# ------------------------------------------------------------------------------
MONITORING_DB_PASSWORD_FILE="${MONITORING_DB_PASSWORD_FILE:-/vault/secrets/monitoring_db_password}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"
POSTGRES_HOST="${POSTGRES_HOST:-database}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-shellsmash}"

echo "[postgres-exporter] Waiting for monitoring DB credential..."

i=0
until [ -s "${MONITORING_DB_PASSWORD_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
  i=$((i + 1))
  sleep 1
done

if [ ! -s "${MONITORING_DB_PASSWORD_FILE}" ]; then
  echo "[postgres-exporter] ERROR: Missing Vault secret file: ${MONITORING_DB_PASSWORD_FILE}" >&2
  exit 1
fi

MONITORING_DB_PASSWORD="$(cat "${MONITORING_DB_PASSWORD_FILE}")"

export DATA_SOURCE_NAME="postgresql://monitoring:${MONITORING_DB_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable"

echo "[postgres-exporter] Starting postgres_exporter (user=monitoring, db=${POSTGRES_DB})..."
exec /usr/local/bin/postgres_exporter "$@"
