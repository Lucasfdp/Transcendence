#!/bin/sh
set -eu

VAULT_ENV_FILE="${VAULT_ENV_FILE:-/vault/secrets/monitoring.env}"
SECRETS_WAIT_TIMEOUT="${SECRETS_WAIT_TIMEOUT:-120}"

echo "[monitoring] Starting Shell Smash monitoring stack..."

i=0
until [ -f "${VAULT_ENV_FILE}" ] || [ "${i}" -ge "${SECRETS_WAIT_TIMEOUT}" ]; do
  i=$((i + 1))
  sleep 1
done

if [ ! -f "${VAULT_ENV_FILE}" ]; then
  echo "[monitoring] ERROR: Missing Vault secrets file: ${VAULT_ENV_FILE}" >&2
  exit 1
fi

set -a
. "${VAULT_ENV_FILE}"
set +a

# ------------------------------------------------------------------------------
# Create volume subdirectories on first boot (the named volume starts empty)
# ------------------------------------------------------------------------------
mkdir -p \
  /var/lib/monitoring/prometheus \
  /var/lib/monitoring/grafana \
  /var/log/monitoring

# Use numeric UIDs: prometheus=9090 (set in Dockerfile), grafana=472 (official Grafana image)
chown -R 9090:9090 /var/lib/monitoring/prometheus 2>/dev/null || true
chown -R 472:472   /var/lib/monitoring/grafana    2>/dev/null || true

# ------------------------------------------------------------------------------
# Render Prometheus config from template
# (substitutes ${PROMETHEUS_SCRAPE_INTERVAL})
# ------------------------------------------------------------------------------
sed -e "s/\${PROMETHEUS_SCRAPE_INTERVAL}/${PROMETHEUS_SCRAPE_INTERVAL:-15s}/g" \
    -e "s/\${BACKEND_SCRAPE_TARGET}/backend:${BACKEND_PORT:-8000}/g" \
    /etc/prometheus/prometheus.yml.tpl \
    > /etc/prometheus/prometheus.yml

chown 9090:9090 /etc/prometheus/prometheus.yml

# Write METRICS_TOKEN to a file so Prometheus can use credentials_file
# (avoids the token appearing in prometheus.yml or supervisord logs)
# Use ${METRICS_TOKEN:-} — under `set -u`, testing an unset var directly
# crash-loops the container with "unbound variable" instead of reaching the
# warning branch below (D4).
if [ -n "${METRICS_TOKEN:-}" ]; then
  printf '%s' "${METRICS_TOKEN}" > /etc/prometheus/metrics_token
  chmod 400 /etc/prometheus/metrics_token
  chown 9090:9090 /etc/prometheus/metrics_token
  echo "[monitoring] METRICS_TOKEN written to /etc/prometheus/metrics_token"
else
  echo "[monitoring] WARNING: METRICS_TOKEN is not set — /api/metrics will be unprotected"
  # Write empty file so Prometheus config is still valid
  touch /etc/prometheus/metrics_token
  chmod 400 /etc/prometheus/metrics_token
  chown 9090:9090 /etc/prometheus/metrics_token
fi

echo "[monitoring] Prometheus config written to /etc/prometheus/prometheus.yml"

# ------------------------------------------------------------------------------
# Grafana env — map our env var names to what Grafana expects.
# These are inherited by supervisord and the grafana child process.
# ------------------------------------------------------------------------------
# Never default a credential (D5): if Vault rendering ever produces an empty
# GF_ADMIN_PASSWORD, fail hard instead of silently booting Grafana with the
# well-known "changeme" password behind what is now a public route.
if [ -z "${GF_ADMIN_PASSWORD:-}" ]; then
  echo "[monitoring] ERROR: GF_ADMIN_PASSWORD is empty or unset — refusing to start with a default credential" >&2
  exit 1
fi

export GF_SECURITY_ADMIN_USER="${GF_ADMIN_USER:-admin}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_ADMIN_PASSWORD}"
export GF_SERVER_HTTP_PORT="${MONITORING_PORT:-3001}"
export GF_PATHS_DATA="/var/lib/monitoring/grafana"
export GF_PATHS_LOGS="/var/log/monitoring"
export GF_ANALYTICS_REPORTING_ENABLED="false"
export GF_ANALYTICS_CHECK_FOR_UPDATES="false"
export GF_SECURITY_DISABLE_GRAVATAR="true"
# Set to "true" via .env in production (requires HTTPS)
export GF_SECURITY_COOKIE_SECURE="${GF_SECURITY_COOKIE_SECURE:-true}"

# ------------------------------------------------------------------------------
# Grafana is only reachable through Nginx at https://<host>:<port>/monitoring/
# (Phase 2). GF_SERVER_DOMAIN defaults to Grafana's own internal listener
# ("localhost"), which is NOT what's user-facing here. Setting it and
# GF_SERVER_ROOT_URL explicitly to the externally-visible host/port (rather
# than using Grafana's "%(protocol)s://%(domain)s" placeholders, which would
# resolve to the wrong http://localhost/ and silently break Grafana 10's
# Origin-header CSRF check on login/state-changing requests) keeps root_url
# matching what the browser actually sees.
#
# GF_SERVER_PROTOCOL stays "http" (the default) on purpose: it controls what
# Grafana's OWN Go listener speaks, not the scheme shown to the browser.
# Nginx terminates TLS and proxies plain HTTP to Grafana — setting this to
# "https" would make Grafana's listener demand a TLS ClientHello (which it
# has no cert configured for) and reject Nginx's proxied requests with
# "400: Client sent an HTTP request to an HTTPS server." root_url's "https://"
# text is sufficient for link generation and CSRF origin matching; it does
# not need server.protocol to match.
# ------------------------------------------------------------------------------
export GF_SERVER_DOMAIN="${DOMAIN_NAME:-localhost}"
export GF_SERVER_ROOT_URL="https://${DOMAIN_NAME:-localhost}:${HTTPS_PORT:-42424}/monitoring/"
export GF_SERVER_SERVE_FROM_SUB_PATH="true"
export GF_USERS_ALLOW_SIGN_UP="false"
export GF_AUTH_ANONYMOUS_ENABLED="false"

echo "[monitoring] Launching supervisord..."
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
