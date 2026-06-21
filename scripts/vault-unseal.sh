#!/bin/sh
set -eu

COMPOSE="docker compose -f docker-compose.yml --env-file .env"
INIT_FILE="secrets/vault/init.txt"

${COMPOSE} up -d vault

i=0
until ${COMPOSE} exec -T vault sh -lc 'vault status >/dev/null 2>&1; code=$?; [ "$code" = 0 ] || [ "$code" = 2 ]'; do
    i=$((i + 1))
    if [ "${i}" -ge 30 ]; then
        echo "[vault-unseal] Vault did not become reachable in time." >&2
        exit 1
    fi
    sleep 2
done

STATUS_OUTPUT="$(${COMPOSE} exec -T vault sh -lc 'vault status 2>/dev/null || true')"

if ! printf '%s\n' "${STATUS_OUTPUT}" | grep -Eq '^Initialized[[:space:]]+true$'; then
    echo "[vault-unseal] Vault is not initialized. Run make vault-init first." >&2
    exit 1
fi

if printf '%s\n' "${STATUS_OUTPUT}" | grep -Eq '^Sealed[[:space:]]+false$'; then
    echo "[vault-unseal] Vault is already unsealed."
    exit 0
fi

if [ ! -f "${INIT_FILE}" ]; then
    echo "[vault-unseal] Missing ${INIT_FILE}. Run make vault-init first." >&2
    exit 1
fi

UNSEAL_KEY="$(sed -n 's/^Unseal Key 1: //p' "${INIT_FILE}" | head -n 1)"

if [ -z "${UNSEAL_KEY}" ]; then
    echo "[vault-unseal] Could not extract unseal key from ${INIT_FILE}." >&2
    exit 1
fi

${COMPOSE} exec -T vault sh -lc "vault operator unseal '${UNSEAL_KEY}'"
