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
COPY conf/grafana/provisioning/dashboards/shellsmash-datastores.json \
     /var/lib/grafana/dashboards/shellsmash-datastores.json
RUN chown -R ${GRAFANA_UID}:${GRAFANA_GID} /var/lib/grafana/dashboards

# Prometheus config template (rendered at runtime by entrypoint.sh)
COPY conf/prometheus.yml.tpl /etc/prometheus/prometheus.yml.tpl
RUN chown 9090:9090 /etc/prometheus/prometheus.yml.tpl

# Build-time config validation (Phase 6): render the template with the same
# defaults entrypoint.sh falls back to, then run it through `promtool check
# config`. Catches YAML/scrape-config typos at build time instead of at
# container boot. `metrics_token` doesn't need real content here — Prometheus
# only checks that the credentials_file path resolves; entrypoint.sh
# overwrites it with the real token at runtime.
RUN touch /etc/prometheus/metrics_token \
    && sed -e "s/\${PROMETHEUS_SCRAPE_INTERVAL}/15s/g" \
           -e "s/\${BACKEND_SCRAPE_TARGET}/backend:8000/g" \
           /etc/prometheus/prometheus.yml.tpl \
    | promtool check config /dev/stdin \
    && rm -f /etc/prometheus/metrics_token

# Supervisord config — explicit path used in entrypoint.sh with -c flag
RUN mkdir -p /etc/supervisor/conf.d
COPY conf/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Entrypoint
COPY tools/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Grafana listens on MONITORING_PORT (default 3001)
EXPOSE 3001

# Healthcheck probes BOTH Grafana and Prometheus (D6). supervisord's
# startretries=3 means Prometheus can go FATAL and stay down while Grafana
# keeps serving /api/health — checking only Grafana left the container
# reporting "healthy" while every panel was flatlined.
# NOTE: GF_SERVER_SERVE_FROM_SUB_PATH=true (Phase 2) mounts Grafana's entire
# router — including /api/health — under /monitoring/. A bare /api/health
# 404s once that's enabled, so the probe must include the subpath.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget --quiet --tries=1 --spider "http://localhost:${MONITORING_PORT:-3001}/monitoring/api/health" \
        && wget --quiet --tries=1 --spider "http://127.0.0.1:9090/-/healthy" \
        || exit 1

# Run as root so supervisord can fork child processes under different users
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
