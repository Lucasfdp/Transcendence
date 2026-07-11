# ==============================================================================
# Shell Smash — Prometheus Configuration (template)
# Rendered at container startup: ${PROMETHEUS_SCRAPE_INTERVAL} and
# ${BACKEND_SCRAPE_TARGET} are replaced by the entrypoint (PROMETHEUS_SCRAPE_INTERVAL
# and BACKEND_PORT env vars respectively) so scraping doesn't silently break
# if the backend's port is ever changed.
# ==============================================================================

global:
  scrape_interval:     ${PROMETHEUS_SCRAPE_INTERVAL}
  evaluation_interval: ${PROMETHEUS_SCRAPE_INTERVAL}
  scrape_timeout:      10s

scrape_configs:

  # ----------------------------------------------------------------------------
  # NestJS backend — exposes /api/metrics with prom-client metrics.
  # Requires Authorization: Bearer <METRICS_TOKEN> header.
  # METRICS_TOKEN is injected via the monitoring service environment.
  # ----------------------------------------------------------------------------
  - job_name: backend
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/metrics_token
    static_configs:
      - targets: ['${BACKEND_SCRAPE_TARGET}']
        labels:
          service: backend

  # ----------------------------------------------------------------------------
  # Prometheus self-scrape
  # ----------------------------------------------------------------------------
  - job_name: prometheus
    static_configs:
      - targets: ['127.0.0.1:9090']
        labels:
          service: prometheus

  # ----------------------------------------------------------------------------
  # Exporters (Monitoring module, Phase 4 / Option A) — internal-only,
  # expose-only compose services, no auth needed on backend_network.
  # ----------------------------------------------------------------------------
  - job_name: postgres
    static_configs:
      - targets: ['postgres_exporter:9187']
        labels:
          service: postgres

  - job_name: redis
    static_configs:
      - targets: ['redis_exporter:9121']
        labels:
          service: redis
