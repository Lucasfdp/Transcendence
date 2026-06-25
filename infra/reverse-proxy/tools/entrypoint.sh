#!/bin/sh
set -eu

SSL_DIR="/etc/nginx/ssl"
CERT_PATH="${SSL_DIR}/cert.pem"
KEY_PATH="${SSL_DIR}/key.pem"
DOMAIN_NAME="${DOMAIN_NAME:-localhost}"
HTTPS_PORT="${HTTPS_PORT:-42424}"
TEMPLATE_PATH="/etc/nginx/templates/default.conf.template"
TARGET_PATH="/etc/nginx/conf.d/default.conf"

mkdir -p "${SSL_DIR}"
envsubst '${DOMAIN_NAME} ${HTTPS_PORT}' < "${TEMPLATE_PATH}" > "${TARGET_PATH}"

cat > /etc/nginx/modsec/main.conf <<'EOF'
Include /etc/nginx/modsec/modsecurity.conf
Include /etc/nginx/modsec/crs-setup.conf
Include /etc/nginx/modsec/crs/rules/*.conf
Include /etc/nginx/modsec/local-exclusions.conf
EOF

if [ -s "${CERT_PATH}" ] && [ -s "${KEY_PATH}" ]; then
  echo "[reverse_proxy] Using pre-generated TLS certificate from ${SSL_DIR}."
  exec "$@"
fi

cat > /tmp/openssl-local.cnf <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
C = FR
ST = IDF
L = Paris
O = 42
CN = ${DOMAIN_NAME}

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = ${DOMAIN_NAME}
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
EOF

echo "[reverse_proxy] No external TLS certificate found. Generating self-signed fallback."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -config /tmp/openssl-local.cnf

chmod 600 "${KEY_PATH}"
chmod 644 "${CERT_PATH}"
rm -f /tmp/openssl-local.cnf

exec "$@"
