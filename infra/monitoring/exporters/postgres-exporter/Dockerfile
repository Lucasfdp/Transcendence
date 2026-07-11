# ==============================================================================
# Shell Smash — postgres_exporter (Prometheus exporter for PostgreSQL)
# ==============================================================================
# Stage 1: source the static postgres_exporter binary from the official image.
# That image ships on quay.io/prometheus/busybox, which has no guaranteed
# shell — we copy just the binary onto a base that does (alpine), so our
# credential-loading entrypoint.sh can run.
# ==============================================================================
FROM quay.io/prometheuscommunity/postgres-exporter:v0.15.0 AS exporter-src

FROM alpine:3.20

LABEL maintainer="Shell Smash"
LABEL description="postgres_exporter — Prometheus metrics for PostgreSQL"

RUN apk add --no-cache ca-certificates \
    && rm -rf /var/cache/apk/*

# Confirmed binary path from the upstream Dockerfile: /bin/postgres_exporter
COPY --from=exporter-src /bin/postgres_exporter /usr/local/bin/postgres_exporter

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Dedicated non-root user — never run the exporter as root
RUN addgroup -S -g 9187 postgres_exporter \
    && adduser -S -u 9187 -G postgres_exporter -H -D postgres_exporter
USER 9187:9187

EXPOSE 9187

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
