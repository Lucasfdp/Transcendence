# ==============================================================================
# Shell Smash — redis_exporter (Prometheus exporter for Redis)
# ==============================================================================
# Stage 1: source the static redis_exporter binary from the official image
# (confirmed binary path from the upstream Dockerfile: /redis_exporter).
# The upstream image ships FROM scratch/alpine with no guaranteed shell for
# our credential-loading entrypoint.sh, so we copy just the binary.
# ==============================================================================
FROM oliver006/redis_exporter:v1.62.0-alpine AS exporter-src

FROM alpine:3.20

LABEL maintainer="Shell Smash"
LABEL description="redis_exporter — Prometheus metrics for Redis"

RUN apk add --no-cache ca-certificates \
    && rm -rf /var/cache/apk/*

COPY --from=exporter-src /redis_exporter /usr/local/bin/redis_exporter

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Dedicated non-root user — never run the exporter as root
RUN addgroup -S -g 9121 redis_exporter \
    && adduser -S -u 9121 -G redis_exporter -H -D redis_exporter
USER 9121:9121

EXPOSE 9121

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
