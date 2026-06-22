#!/bin/sh
set -eu

COMPOSE="docker compose -f docker-compose.yml --env-file .env"
INIT_FILE="secrets/vault/init.txt"
SEED_FILE="secrets/vault/dev-seed.env"

generate_secret() {
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
}

ensure_writable_dir() {
    dir="$1"

    mkdir -p "$dir" 2>/dev/null || true

    if [ ! -d "$dir" ]; then
        echo "[vault-seed] Could not create ${dir}." >&2
        echo "[vault-seed] Ensure $(pwd)/${dir} is writable by user $(id -un)." >&2
        exit 1
    fi

    if [ ! -w "$dir" ]; then
        echo "[vault-seed] ${dir} is not writable by user $(id -un)." >&2
        echo "[vault-seed] Fix it with: sudo chown -R $(id -un):$(id -gn) secrets" >&2
        exit 1
    fi
}

if [ ! -f "${INIT_FILE}" ]; then
    echo "[vault-seed] Missing ${INIT_FILE}. Run make vault-init and make vault-unseal first." >&2
    exit 1
fi

STATUS_OUTPUT="$(${COMPOSE} exec -T vault sh -lc 'vault status 2>/dev/null || true')"

if ! printf '%s\n' "${STATUS_OUTPUT}" | grep -Eq '^Initialized[[:space:]]+true$'; then
    echo "[vault-seed] Vault is not initialized. Run make vault-init first." >&2
    exit 1
fi

if ! printf '%s\n' "${STATUS_OUTPUT}" | grep -Eq '^Sealed[[:space:]]+false$'; then
    echo "[vault-seed] Vault is sealed. Run make vault-unseal first." >&2
    exit 1
fi

ROOT_TOKEN="$(sed -n 's/^Initial Root Token: //p' "${INIT_FILE}" | head -n 1)"

if [ -z "${ROOT_TOKEN}" ]; then
    echo "[vault-seed] Could not extract root token from ${INIT_FILE}." >&2
    exit 1
fi

ensure_writable_dir "secrets"
ensure_writable_dir "secrets/vault"
ensure_writable_dir "secrets/vault/approle/backend"
ensure_writable_dir "secrets/vault/approle/database"
ensure_writable_dir "secrets/vault/approle/redis"
ensure_writable_dir "secrets/vault/approle/monitoring"

if [ ! -f "${SEED_FILE}" ]; then
    cat > "${SEED_FILE}" <<EOF
POSTGRES_PASSWORD=$(generate_secret)
REDIS_PASSWORD=$(generate_secret)
JWT_SECRET=$(generate_secret)
SECRET_KEY=$(generate_secret)
METRICS_TOKEN=$(generate_secret)
GF_ADMIN_PASSWORD=$(generate_secret)
FORTYTWO_CLIENT_ID=
FORTYTWO_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
EOF
    chmod 600 "${SEED_FILE}"
    echo "[vault-seed] Created ${SEED_FILE}. Fill OAuth credentials there if needed, then rerun this target."
fi

set -a
. "${SEED_FILE}"
set +a

${COMPOSE} exec -T \
    -e VAULT_TOKEN="${ROOT_TOKEN}" \
    -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
    -e JWT_SECRET="${JWT_SECRET}" \
    -e SECRET_KEY="${SECRET_KEY}" \
    -e METRICS_TOKEN="${METRICS_TOKEN}" \
    -e GF_ADMIN_PASSWORD="${GF_ADMIN_PASSWORD}" \
    -e FORTYTWO_CLIENT_ID="${FORTYTWO_CLIENT_ID}" \
    -e FORTYTWO_CLIENT_SECRET="${FORTYTWO_CLIENT_SECRET}" \
    -e GITHUB_CLIENT_ID="${GITHUB_CLIENT_ID}" \
    -e GITHUB_CLIENT_SECRET="${GITHUB_CLIENT_SECRET}" \
    vault sh -lc '
        vault secrets enable -path=kv kv-v2 >/dev/null 2>&1 || true
        vault auth enable approle >/dev/null 2>&1 || true

        vault kv put kv/transcendence/dev/backend \
            SECRET_KEY="$SECRET_KEY" \
            JWT_SECRET="$JWT_SECRET" \
            FORTYTWO_CLIENT_ID="$FORTYTWO_CLIENT_ID" \
            FORTYTWO_CLIENT_SECRET="$FORTYTWO_CLIENT_SECRET" \
            GITHUB_CLIENT_ID="$GITHUB_CLIENT_ID" \
            GITHUB_CLIENT_SECRET="$GITHUB_CLIENT_SECRET" \
            METRICS_TOKEN="$METRICS_TOKEN" \
            POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            REDIS_PASSWORD="$REDIS_PASSWORD"

        vault kv put kv/transcendence/dev/database \
            POSTGRES_PASSWORD="$POSTGRES_PASSWORD"

        vault kv put kv/transcendence/dev/redis \
            REDIS_PASSWORD="$REDIS_PASSWORD"

        vault kv put kv/transcendence/dev/monitoring \
            GF_ADMIN_PASSWORD="$GF_ADMIN_PASSWORD" \
            METRICS_TOKEN="$METRICS_TOKEN"
    '

for service in backend database redis monitoring; do
    role_name="${service}-dev"
    policy_path="/vault/policies/${service}.hcl"
    approle_dir="secrets/vault/approle/${service}"

    ${COMPOSE} exec -T -e VAULT_TOKEN="${ROOT_TOKEN}" vault \
        sh -lc "vault policy write ${service} ${policy_path}"
    ${COMPOSE} exec -T -e VAULT_TOKEN="${ROOT_TOKEN}" vault \
        sh -lc "vault write auth/approle/role/${role_name} token_policies=${service} token_ttl=1h token_max_ttl=4h secret_id_ttl=0 >/dev/null"

    ${COMPOSE} exec -T -e VAULT_TOKEN="${ROOT_TOKEN}" vault \
        sh -lc "vault read -field=role_id auth/approle/role/${role_name}/role-id" \
        > "${approle_dir}/role_id"
    ${COMPOSE} exec -T -e VAULT_TOKEN="${ROOT_TOKEN}" vault \
        sh -lc "vault write -f -field=secret_id auth/approle/role/${role_name}/secret-id" \
        > "${approle_dir}/secret_id"

    chmod 600 "${approle_dir}/role_id" "${approle_dir}/secret_id"
done

echo "[vault-seed] Wrote AppRole credentials under secrets/vault/approle/"
