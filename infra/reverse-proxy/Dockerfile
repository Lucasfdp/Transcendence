FROM debian:bookworm-slim

LABEL maintainer="ft_transcendence"
LABEL description="Nginx reverse proxy with TLS termination and ModSecurity WAF"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx \
        libnginx-mod-http-modsecurity \
        modsecurity-crs \
        openssl \
        curl \
        ca-certificates \
        gettext-base \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p \
        /etc/nginx/templates \
        /etc/nginx/modsec/crs/rules \
        /etc/nginx/ssl \
        /var/log/nginx \
        /var/cache/nginx/client_temp \
        /var/cache/nginx/proxy_temp \
        /var/cache/nginx/fastcgi_temp \
        /var/cache/nginx/uwsgi_temp \
        /var/cache/nginx/scgi_temp \
        /tmp/modsecurity/tmp \
        /tmp/modsecurity/data

RUN set -eux; \
    unicode_path=""; \
    for candidate in \
        /etc/nginx/unicode.mapping \
        /etc/modsecurity/unicode.mapping \
        /usr/share/modsecurity-crs/unicode.mapping \
        /usr/share/modsecurity/unicode.mapping; do \
        if [ -f "$candidate" ]; then unicode_path="$candidate"; break; fi; \
    done; \
    cp "$unicode_path" /etc/nginx/modsec/unicode.mapping; \
    rules_path=""; \
    for candidate in /usr/share/modsecurity-crs/rules /etc/modsecurity/crs/rules; do \
        if [ -d "$candidate" ]; then rules_path="$candidate"; break; fi; \
    done; \
    cp -R "$rules_path"/. /etc/nginx/modsec/crs/rules/

RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

COPY conf/nginx.conf /etc/nginx/nginx.conf
COPY conf/default.conf.template /etc/nginx/templates/default.conf.template
COPY conf/modsecurity.conf /etc/nginx/modsec/modsecurity.conf
COPY conf/crs-setup.conf /etc/nginx/modsec/crs-setup.conf
COPY conf/local-exclusions.conf /etc/nginx/modsec/local-exclusions.conf
COPY tools/entrypoint.sh /usr/local/bin/reverse-proxy-entrypoint.sh

RUN chmod +x /usr/local/bin/reverse-proxy-entrypoint.sh \
    && chown -R www-data:www-data /var/log/nginx /var/cache/nginx /tmp/modsecurity

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/reverse-proxy-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
