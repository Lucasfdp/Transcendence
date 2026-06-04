# ==============================================================================
# ft_transcendence — Monitoring Service
# ==============================================================================
# PLACEHOLDER — Replace with Grafana + Prometheus when ready.
#
# Planned integration:
#   Grafana      → Dashboard UI
#   Prometheus   → Metrics scraper
#   Loki         → Log aggregation
#   Alertmanager → Alert routing
#   Node Exporter→ Host metrics
#
# To replace:
#   1. Change FROM to grafana/grafana:10-alpine
#   2. Mount provisioning configs into /etc/grafana/provisioning/
#   3. Set GF_SECURITY_ADMIN_USER / GF_SECURITY_ADMIN_PASSWORD via .env
# ==============================================================================

FROM alpine:3.19

LABEL maintainer="ft_transcendence"
LABEL description="Monitoring stack placeholder (Grafana/Prometheus)"

RUN apk update && apk add --no-cache wget curl && rm -rf /var/cache/apk/*

# Non-root user
RUN addgroup -S monitoring && adduser -S monitor -G monitoring

RUN mkdir -p /var/lib/monitoring /var/log/monitoring \
    && chown -R monitor:monitoring /var/lib/monitoring /var/log/monitoring

COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Health flag file used by the placeholder healthcheck
RUN touch /tmp/healthy && chown monitor:monitoring /tmp/healthy

USER monitor

EXPOSE 3000

# --------------------------------------------------------------------------
# Healthcheck — placeholder mode
# --------------------------------------------------------------------------
# Verifies the process is alive via a flag file.
# Once Grafana is running, replace with:
#   CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
# --------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD test -f /tmp/healthy || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
