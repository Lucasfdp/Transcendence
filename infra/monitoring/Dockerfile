# ==============================================================================
# Shell Smash — Monitoring Service (Grafana + Prometheus via supervisord)
# ==============================================================================
# Stage 1: Source Prometheus binaries from the official image.
# This avoids fragile GitHub release downloads during `docker build` while
# still keeping the version pinned.
# ==============================================================================
FROM prom/prometheus:v2.53.4 AS prometheus-downloader

# ==============================================================================
# Stage 2: Final image — Grafana 10.4.3 + Prometheus + supervisord
# ==============================================================================
FROM grafana/grafana:10.4.3@sha256:b7fcb534f7b3512801bb3f4e658238846435804deb479d105b5cdc680847c272

LABEL maintainer="Shell Smash"
LABEL description="Grafana + Prometheus observability stack (supervisord)"

# Grafana runs as UID/GID 472 in the official image.
# We reference numeric IDs throughout because the named group is not always
# present (varies by Grafana image variant).
ARG GRAFANA_UID=472
ARG GRAFANA_GID=472

# Run all setup as root
USER root

# Install supervisor.
# In Alpine, the package is 'supervisor'; it provides /usr/bin/supervisord.
RUN apk add --no-cache supervisor ca-certificates \
    && rm -rf /var/cache/apk/*

# Copy Prometheus binaries from the downloader stage
COPY --from=prometheus-downloader /bin/prometheus /usr/local/bin/prometheus
COPY --from=prometheus-downloader /bin/promtool   /usr/local/bin/promtool

# Create a dedicated non-root user for Prometheus (Alpine adduser syntax)
RUN addgroup -S -g 9090 prometheus \
    && adduser -S -u 9090 -G prometheus -H -D prometheus

# Create directories Prometheus needs; ensure correct ownership
RUN mkdir -p /etc/prometheus /var/lib/monitoring/prometheus \
    && chown -R 9090:9090 /etc/prometheus /var/lib/monitoring/prometheus

# Grafana provisioning — datasources and dashboard provider
# /etc/grafana/provisioning already exists in the base image; we overwrite it.
COPY conf/grafana/provisioning /etc/grafana/provisioning
RUN chown -R ${GRAFANA_UID}:${GRAFANA_GID} /etc/grafana/provisioning

# Grafana dashboard JSON files baked into the image
# (survive volume mounts of /var/lib/monitoring/grafana)
RUN mkdir -p /var/lib/grafana/dashboards
COPY conf/grafana/provisioning/dashboards/shellsmash-overview.json \
     /var/lib/grafana/dashboards/shellsmash-overview.json
COPY conf/grafana/provisioning/dashboards/shellsmash-infra.json \
     /var/lib/grafana/dashboards/shellsmash-infra.json
RUN chown -R ${GRAFANA_UID}:${GRAFANA_GID} /var/lib/grafana/dashboards

# Prometheus config template (rendered at runtime by entrypoint.sh)
COPY conf/prometheus.yml.tpl /etc/prometheus/prometheus.yml.tpl
RUN chown 9090:9090 /etc/prometheus/prometheus.yml.tpl

# Supervisord config — explicit path used in entrypoint.sh with -c flag
RUN mkdir -p /etc/supervisor/conf.d
COPY conf/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Entrypoint
COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Grafana listens on MONITORING_PORT (default 3001)
EXPOSE 3001

# Healthcheck hits Grafana's built-in /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget --quiet --tries=1 --spider "http://localhost:${MONITORING_PORT:-3001}/api/health" || exit 1

# Run as root so supervisord can fork child processes under different users
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
