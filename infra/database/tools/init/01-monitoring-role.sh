#!/bin/sh
set -eu

# ------------------------------------------------------------------------------
# Creates a dedicated, read-only monitoring role for postgres_exporter
# (Monitoring module, Phase 4 / Option A). Granting pg_monitor instead of
# reusing the superuser credential means the exporter can read
# pg_stat_activity / pg_stat_database etc. but cannot read or modify
# application data.
#
# Runs automatically on first database initialisation via
# /docker-entrypoint-initdb.d/ (only when PGDATA is empty — see the
# postgres image's own entrypoint). The password is loaded from a
# Vault-rendered secret file, never hardcoded or passed as a literal.
# ------------------------------------------------------------------------------

MONITORING_DB_PASSWORD_FILE="${MONITORING_DB_PASSWORD_FILE:-/vault/secrets/monitoring_db_password}"

if [ ! -s "${MONITORING_DB_PASSWORD_FILE}" ]; then
  echo "[database-init] WARNING: ${MONITORING_DB_PASSWORD_FILE} missing or empty — skipping monitoring role creation (postgres_exporter will fail to authenticate)" >&2
  exit 0
fi

MONITORING_DB_PASSWORD="$(cat "${MONITORING_DB_PASSWORD_FILE}")"

psql -v ON_ERROR_STOP=1 \
     --username "${POSTGRES_USER}" \
     --dbname "${POSTGRES_DB}" \
     -v monitoring_password="${MONITORING_DB_PASSWORD}" <<-'EOSQL'
    DO
    $$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'monitoring') THEN
            CREATE ROLE monitoring WITH LOGIN;
        END IF;
    END
    $$;

    ALTER ROLE monitoring WITH PASSWORD :'monitoring_password';
    GRANT pg_monitor TO monitoring;
EOSQL

echo "[database-init] monitoring role ready (pg_monitor granted)"
