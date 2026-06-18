#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${ROOT_DIR}/secrets/nginx_ssl"
DOMAIN_NAME="${DOMAIN_NAME:-localhost}"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is not installed. Install it first, then rerun this script." >&2
  exit 1
fi

mkdir -p "${CERT_DIR}"

mkcert -install
mkcert \
  -cert-file "${CERT_DIR}/cert.pem" \
  -key-file "${CERT_DIR}/key.pem" \
  "${DOMAIN_NAME}" \
  localhost \
  127.0.0.1 \
  ::1

chmod 600 "${CERT_DIR}/key.pem"
chmod 644 "${CERT_DIR}/cert.pem"

echo "Local development certificates written to ${CERT_DIR}"
