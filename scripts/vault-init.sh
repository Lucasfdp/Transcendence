#!/bin/sh
set -eu

COMPOSE="docker compose -f docker-compose.yml --env-file .env"
INIT_FILE="secrets/vault/init.txt"

ensure_writable_dir() {
    dir="$1"

    mkdir -p "$dir" 2>/dev/null || true

    if [ ! -d "$dir" ]; then
        echo "[vault-init] Could not create ${dir}." >&2
        echo "[vault-init] Ensure $(pwd)/${dir} is writable by user $(id -un)." >&2
        exit 1
    fi

    if [ ! -w "$dir" ]; then
        echo "[vault-init] ${dir} is not writable by user $(id -un)." >&2
        echo "[vault-init] Fix it with: sudo chown -R $(id -un):$(id -gn) secrets" >&2
        exit 1
    fi
}

ensure_writable_dir "secrets"
ensure_writable_dir "secrets/vault"

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
