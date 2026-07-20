#!/bin/sh
set -eu

SSL_DIR="/etc/nginx/ssl"
CERT_PATH="${SSL_DIR}/cert.pem"
KEY_PATH="${SSL_DIR}/key.pem"
DOMAIN_NAME="${DOMAIN_NAME:-localhost}"
HTTPS_PORT="${HTTPS_PORT:-42424}"
PUBLIC_HTTP_ORIGIN="https://${DOMAIN_NAME}:${HTTPS_PORT}"
PUBLIC_WS_ORIGIN="wss://${DOMAIN_NAME}:${HTTPS_PORT}"
export DOMAIN_NAME HTTPS_PORT PUBLIC_HTTP_ORIGIN PUBLIC_WS_ORIGIN
TEMPLATE_PATH="/etc/nginx/templates/default.conf.template"
TARGET_PATH="/etc/nginx/conf.d/default.conf"
HTTPS_REQUIRED_TEMPLATE="/usr/share/nginx/html/https-required.html.template"
HTTPS_REQUIRED_PAGE="/usr/share/nginx/html/https-required.html"

mkdir -p "${SSL_DIR}"
envsubst '${DOMAIN_NAME} ${HTTPS_PORT} ${PUBLIC_HTTP_ORIGIN} ${PUBLIC_WS_ORIGIN}' < "${TEMPLATE_PATH}" > "${TARGET_PATH}"
# The "Enter with HTTPS" link is rewritten per-request by nginx's sub_filter
# (see default.conf.template) from the client's own Host header, not baked in
# here — a build/deploy-time DOMAIN_NAME (default "localhost") would send
# every visitor back to https://localhost regardless of the host or IP they
# actually used to reach the server.
cp "${HTTPS_REQUIRED_TEMPLATE}" "${HTTPS_REQUIRED_PAGE}"

cat > /etc/nginx/modsec/main.conf <<'EOF'
Include /etc/nginx/modsec/modsecurity.conf
Include /etc/nginx/modsec/crs-setup.conf
Include /etc/nginx/modsec/crs/rules/*.conf
Include /etc/nginx/modsec/local-exclusions.conf
EOF

if [ -s "${CERT_PATH}" ] && [ -s "${KEY_PATH}" ] && openssl x509 -in "${CERT_PATH}" -noout -ext subjectAltName 2>/dev/null | grep -Eq "(DNS|IP Address):${DOMAIN_NAME}([,[:space:]]|$)"; then
  echo "[reverse_proxy] Using pre-generated TLS certificate from ${SSL_DIR}."
  exec "$@"
fi

DOMAIN_ALT_TYPE="DNS"
LOCALHOST_IP_ALT_INDEX="1"
if printf '%s' "${DOMAIN_NAME}" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
  DOMAIN_ALT_TYPE="IP"
  LOCALHOST_IP_ALT_INDEX="2"
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
${DOMAIN_ALT_TYPE}.1 = ${DOMAIN_NAME}
DNS.1 = localhost
IP.${LOCALHOST_IP_ALT_INDEX} = 127.0.0.1
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
