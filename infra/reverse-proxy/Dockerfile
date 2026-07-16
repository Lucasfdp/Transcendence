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

COPY infra/reverse-proxy/conf/nginx.conf /etc/nginx/nginx.conf
COPY infra/reverse-proxy/conf/default.conf.template /etc/nginx/templates/default.conf.template
COPY infra/reverse-proxy/conf/modsecurity.conf /etc/nginx/modsec/modsecurity.conf
COPY infra/reverse-proxy/conf/crs-setup.conf /etc/nginx/modsec/crs-setup.conf
COPY infra/reverse-proxy/conf/local-exclusions.conf /etc/nginx/modsec/local-exclusions.conf
COPY infra/reverse-proxy/html/https-required.html.template /tmp/https-required.html.template
COPY infra/reverse-proxy/tools/entrypoint.sh /usr/local/bin/reverse-proxy-entrypoint.sh
COPY frontend/src/assets/fonts/blowbrush.otf /tmp/blowbrush.otf
COPY frontend/src/assets/fonts/Rowdy-Regular.ttf /tmp/rowdy-regular.ttf
COPY public/assets/logoShellSmash.png /tmp/shellsmash-logo.png
COPY public/assets/character/samurai-turtle.webp /tmp/samurai-turtle.webp
COPY public/assets/character/sumo-turtle.webp /tmp/sumo-turtle.webp

# A request made with plain HTTP to the TLS port cannot load normal static
# assets: every follow-up request would itself become Nginx error 497. Embed the
# artwork and fonts so the explanatory page is complete in a single response.
RUN set -eux; \
    mkdir -p /usr/share/nginx/html; \
    cp /tmp/https-required.html.template /usr/share/nginx/html/https-required.html.template; \
    base64 -w 0 /tmp/blowbrush.otf > /tmp/blowbrush.b64; \
    base64 -w 0 /tmp/rowdy-regular.ttf > /tmp/rowdy-regular.b64; \
    base64 -w 0 /tmp/shellsmash-logo.png > /tmp/shellsmash-logo.b64; \
    base64 -w 0 /tmp/samurai-turtle.webp > /tmp/samurai-turtle.b64; \
    base64 -w 0 /tmp/sumo-turtle.webp > /tmp/sumo-turtle.b64; \
    TEMPLATE=/usr/share/nginx/html/https-required.html.template \
        TOKEN='${BLOWBRUSH_FONT_DATA}' DATA=/tmp/blowbrush.b64 \
        perl -0pi -e 'BEGIN { local $/; open my $fh, "<", $ENV{DATA} or die $!; $data = <$fh> } s/\Q$ENV{TOKEN}\E/$data/g' \
        /usr/share/nginx/html/https-required.html.template; \
    TEMPLATE=/usr/share/nginx/html/https-required.html.template \
        TOKEN='${ROWDY_FONT_DATA}' DATA=/tmp/rowdy-regular.b64 \
        perl -0pi -e 'BEGIN { local $/; open my $fh, "<", $ENV{DATA} or die $!; $data = <$fh> } s/\Q$ENV{TOKEN}\E/$data/g' \
        /usr/share/nginx/html/https-required.html.template; \
    TEMPLATE=/usr/share/nginx/html/https-required.html.template \
        TOKEN='${SHELLSMASH_LOGO_DATA}' DATA=/tmp/shellsmash-logo.b64 \
        perl -0pi -e 'BEGIN { local $/; open my $fh, "<", $ENV{DATA} or die $!; $data = <$fh> } s/\Q$ENV{TOKEN}\E/$data/g' \
        /usr/share/nginx/html/https-required.html.template; \
    TEMPLATE=/usr/share/nginx/html/https-required.html.template \
        TOKEN='${SAMURAI_TURTLE_DATA}' DATA=/tmp/samurai-turtle.b64 \
        perl -0pi -e 'BEGIN { local $/; open my $fh, "<", $ENV{DATA} or die $!; $data = <$fh> } s/\Q$ENV{TOKEN}\E/$data/g' \
        /usr/share/nginx/html/https-required.html.template; \
    TEMPLATE=/usr/share/nginx/html/https-required.html.template \
        TOKEN='${SUMO_TURTLE_DATA}' DATA=/tmp/sumo-turtle.b64 \
        perl -0pi -e 'BEGIN { local $/; open my $fh, "<", $ENV{DATA} or die $!; $data = <$fh> } s/\Q$ENV{TOKEN}\E/$data/g' \
        /usr/share/nginx/html/https-required.html.template; \
    rm -f /tmp/https-required.html.template /tmp/blowbrush.otf \
        /tmp/rowdy-regular.ttf /tmp/shellsmash-logo.png \
        /tmp/samurai-turtle.webp /tmp/sumo-turtle.webp /tmp/*.b64

RUN chmod +x /usr/local/bin/reverse-proxy-entrypoint.sh \
    && chown -R www-data:www-data /var/log/nginx /var/cache/nginx /tmp/modsecurity

EXPOSE 42424

ENTRYPOINT ["/usr/local/bin/reverse-proxy-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
