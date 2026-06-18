# ==============================================================================
# ft_transcendence — Redis Service
# ==============================================================================
# Based on the official Redis Alpine image.
#
# Use cases in ft_transcendence:
#   1. Session storage      — Store JWT refresh tokens and invalidation lists
#   2. Pub/Sub broker       — Route WebSocket events between backend workers
#   3. Caching              — Cache expensive queries (leaderboard, game stats)
#   4. Rate limiting        — Sliding window counters per IP / user
#   5. Matchmaking queues   — FIFO queues for lobby and tournament matching
#   6. Live game state      — Temporary key-value storage during active sessions
#
# Security:
#   - Protected by password (REDIS_PASSWORD environment variable)
#   - ONLY accessible from backend_network (no host port exposure)
#   - Consider enabling TLS (stunnel sidecar) for inter-service encryption
#
# Persistence:
#   - RDB snapshots (point-in-time backup) are enabled by default
#   - AOF (append-only file) can be enabled for stronger durability guarantees:
#     appendonly yes  (in redis.conf)
# ==============================================================================

FROM redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99

LABEL maintainer="ft_transcendence"
LABEL description="Redis in-memory data store"

RUN apk update && apk add --no-cache \
    && rm -rf /var/cache/apk/*

# Copy custom Redis configuration template
COPY tools/redis.conf /etc/redis/redis.conf

COPY tools/entrypoint.sh /usr/local/bin/redis-custom-entrypoint.sh
RUN chmod +x /usr/local/bin/redis-custom-entrypoint.sh

# Redis data directory (RDB + AOF files)
VOLUME /data

EXPOSE 6379

# --------------------------------------------------------------------------
# Healthcheck
# --------------------------------------------------------------------------
# Uses redis-cli PING to verify the server is accepting commands.
# The -a flag passes the password; the pipe to grep ensures PONG is returned.
# --------------------------------------------------------------------------
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD redis-cli -a "${REDIS_PASSWORD}" ping | grep PONG || exit 1

ENTRYPOINT ["/usr/local/bin/redis-custom-entrypoint.sh"]
