# ==============================================================================
# Shell Smash — Prometheus Configuration (template)
# Rendered at container startup: ${PROMETHEUS_SCRAPE_INTERVAL} is replaced by
# the entrypoint with the PROMETHEUS_SCRAPE_INTERVAL env var.
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
      - targets: ['backend:8000']
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
