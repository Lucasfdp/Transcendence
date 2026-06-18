# ==============================================================================
# ft_transcendence — Database Service (PostgreSQL)
# ==============================================================================
# Based on the official PostgreSQL Alpine image.
# Alpine images are ~5× smaller than the Debian-based ones.
#
# Security hardening applied:
#   - PostgreSQL listens only on the Docker internal network (no host port)
#   - Credentials are injected via environment variables
#     (upgrade to Docker Secrets for production)
#   - The postgres superuser is locked to the credentials in POSTGRES_USER
#
# Backup strategy:
#   Manual:    docker compose exec database pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
#   Automated: Consider a separate backup container with a cron job:
#              pg_dump | gzip > /backups/$(date +%Y%m%d_%H%M%S).sql.gz
#   Restore:   docker compose exec -T database psql -U $POSTGRES_USER $POSTGRES_DB < backup.sql
#
# Volume:
#   /var/lib/postgresql/data → named volume db_data (defined in compose)
# ==============================================================================

FROM postgres:16-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50

LABEL maintainer="ft_transcendence"
LABEL description="PostgreSQL database service"

# Install additional tools for healthcheck and debugging
RUN apk update && apk add --no-cache \
    curl \
    && rm -rf /var/cache/apk/*

# --------------------------------------------------------------------------
# Initialisation scripts
# --------------------------------------------------------------------------
# Any *.sql or *.sh files copied to /docker-entrypoint-initdb.d/ are run
# automatically on the first database initialisation (when PGDATA is empty).
# Files are executed in alphabetical order.
# --------------------------------------------------------------------------
# COPY tools/init.sql /docker-entrypoint-initdb.d/01_init.sql
# COPY tools/seed.sql /docker-entrypoint-initdb.d/02_seed.sql

COPY tools/entrypoint.sh /usr/local/bin/custom-entrypoint.sh
RUN chmod +x /usr/local/bin/custom-entrypoint.sh

# PostgreSQL data directory
VOLUME /var/lib/postgresql/data

EXPOSE 5432

# --------------------------------------------------------------------------
# Healthcheck
# --------------------------------------------------------------------------
# pg_isready checks whether the server is ready to accept connections.
# The backend service uses this condition to wait before running migrations.
# --------------------------------------------------------------------------
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1

# Use the official PostgreSQL entrypoint (handles init scripts automatically)
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres", "-c", "log_connections=on", "-c", "log_disconnections=on"]
