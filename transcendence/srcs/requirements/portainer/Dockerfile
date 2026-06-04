# ==============================================================================
# ft_transcendence — Portainer Service
# ==============================================================================
# Portainer Community Edition provides a web-based Docker management UI.
#
# DEVELOPMENT / DEBUGGING ONLY
# ─────────────────────────────
# Portainer is a convenience tool for the development team. It is NOT required
# for the project to function. Before 42 evaluation:
#   1. Comment out the 'portainer' service in docker-compose.yml, OR
#   2. Remove the ports mapping so it is not externally accessible
#
# Why Portainer should not be required for deployment:
#   - It has full Docker socket access (equivalent to root on the host)
#   - It is not part of the application architecture
#   - The project must be fully deployable with 'make up' without it
#
# Security considerations:
#   - Portainer exposes HTTPS on port 9443 inside the container
#   - Restrict PORTAINER_PORT in your firewall to localhost only
#   - Always set a strong admin password on first login
#   - The Docker socket is mounted read-only where possible
# ==============================================================================

FROM portainer/portainer-ce:2.19.4-alpine

LABEL maintainer="ft_transcendence"
LABEL description="Portainer Docker management UI (dev only)"

# Portainer data directory (stores credentials and configuration)
VOLUME /data

# Docker socket is mounted via compose (read-only)

EXPOSE 9000 9443

# Portainer uses its own entrypoint
# CMD is intentionally not overridden
