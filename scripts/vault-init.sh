#!/bin/sh
set -eu

COMPOSE="docker compose -f docker-compose.yml --env-file .env"
INIT_FILE="secrets/vault/init.txt"

mkdir -p secrets/vault

${COMPOSE} up -d vault

i=0
until ${COMPOSE} exec -T vault sh -lc 'vault status >/dev/null 2>&1; code=$?; [ "$code" = 0 ] || [ "$code" = 2 ]'; do
    i=$((i + 1))
    if [ "${i}" -ge 30 ]; then
        echo "[vault-init] Vault did not become reachable in time." >&2
        exit 1
    fi
    sleep 2
done

STATUS_OUTPUT="$(${COMPOSE} exec -T vault sh -lc 'vault status 2>/dev/null || true')"

if printf '%s\n' "${STATUS_OUTPUT}" | grep -Eq '^Initialized[[:space:]]+true$'; then
    echo "[vault-init] Vault is already initialized."
    exit 0
fi

if [ -f "${INIT_FILE}" ]; then
    echo "[vault-init] ${INIT_FILE} exists but Vault is fresh. Overwriting stale bootstrap material."
fi

${COMPOSE} exec -T vault sh -lc 'vault operator init -key-shares=1 -key-threshold=1' > "${INIT_FILE}"
chmod 600 "${INIT_FILE}"

echo "[vault-init] Wrote bootstrap material to ${INIT_FILE}"
