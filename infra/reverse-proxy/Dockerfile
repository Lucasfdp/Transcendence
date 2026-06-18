# ==============================================================================
# ft_transcendence — Reverse Proxy (Nginx)
# ==============================================================================
# Base image: Alpine Linux for minimal attack surface.
# Nginx is compiled from source packages available in the Alpine repo.
#
# This Dockerfile:
#   1. Installs Nginx + OpenSSL
#   2. Copies the Nginx configuration template
#   3. Installs an entrypoint that generates a local TLS certificate on startup
#   4. Creates a non-root user to run Nginx worker processes
#
# Production note:
#   Replace the self-signed certificate generation with a Let's Encrypt
#   Certbot sidecar or a pre-issued certificate mounted via Docker Secrets.
# ==============================================================================

FROM alpine:3.19

LABEL maintainer="ft_transcendence"
LABEL description="Nginx reverse proxy with TLS termination"

# Install Nginx and OpenSSL
RUN apk update && apk add --no-cache \
    nginx \
    openssl \
    curl \
    && rm -rf /var/cache/apk/*

# Create directories for SSL certificates and Nginx config
RUN mkdir -p /etc/nginx/ssl \
             /etc/nginx/http.d \
             /var/log/nginx \
             /var/www/html

# Remove Alpine's default server config and install ours
# Alpine's nginx.conf includes /etc/nginx/http.d/*.conf inside the http block
RUN rm -f /etc/nginx/http.d/default.conf
COPY conf/default.conf /etc/nginx/http.d/default.conf

COPY tools/entrypoint.sh /usr/local/bin/reverse-proxy-entrypoint.sh
RUN chmod +x /usr/local/bin/reverse-proxy-entrypoint.sh

# ------------------------------------------------------------------------------
# Non-root user setup
# ------------------------------------------------------------------------------
# Nginx master process must start as root (to bind port 443) but worker
# processes are dropped to the 'nginx' user automatically.
# The 'nginx' user is created by the Alpine nginx package.
# ------------------------------------------------------------------------------
RUN chown -R nginx:nginx /var/log/nginx \
    && chown -R nginx:nginx /var/www/html \
    && chown -R nginx:nginx /etc/nginx/http.d

# Forward logs to Docker logging driver
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/reverse-proxy-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
