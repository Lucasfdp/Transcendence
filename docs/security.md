# Security

Security considerations for the ft_transcendence Docker infrastructure.

---

## TLS / HTTPS

The project enforces HTTPS exclusively. A plain HTTP request sent to the
published TLS port receives a branded `426 Upgrade Required` page with a link
back to the secure ShellSmash entrance. Nginx handles this response locally via
its internal `497` status, before any request can reach the frontend or backend.

### Self-signed certificates (development)

The `reverse_proxy` Dockerfile generates a self-signed certificate using OpenSSL on build. This is acceptable for local development but will trigger browser security warnings.

```bash
# Regenerate the self-signed cert manually
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout key.pem -out cert.pem \
    -subj "/C=FR/ST=IDF/L=Paris/O=42/CN=localhost"
```

### Let's Encrypt (production)

For a real domain, replace the self-signed cert with a Let's Encrypt certificate:

1. Add a Certbot sidecar container that writes to the `nginx_ssl` volume.
2. Update the Nginx config to load from `/etc/nginx/ssl/fullchain.pem`.
3. Add a cron job / Compose restart policy to renew the cert automatically.

### TLS version enforcement

Only TLS 1.2 and 1.3 are allowed (42 project requirement). SSLv3, TLSv1.0, and TLSv1.1 are disabled in the Nginx config.

---

## Non-Root Containers

Running application processes as root inside a container is a security risk. If a vulnerability allows container escape, the attacker gains root access to the host.

Every service in this project creates and uses a non-root system user:

```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

**Exception:** Nginx master process must bind to port 443 (privileged port < 1024), which requires starting as root. Worker processes are automatically dropped to the `nginx` user by the Nginx process manager.

---

## Network Segmentation

Network isolation is the primary security control that prevents lateral movement between containers.

| Attack scenario         | Mitigation                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| Compromised frontend    | Frontend is on `frontend_network` only — cannot reach `database` or `redis` |
| Compromised Nginx       | Nginx has no credentials and no direct DB connection                        |
| Brute-force on Redis    | Redis is not on `frontend_network`; only backend can reach it               |
| Port scan from internet | Only ports 80 and 443 are exposed on the host                               |

---

## Secrets Management

### Current approach (development)

Credentials are stored in `.env` and injected via Docker Compose `environment:` blocks. The `.env` file is excluded from version control via `.gitignore`.

### Production approach: Docker Secrets

Docker Swarm (or Kubernetes) provides a native secrets mechanism where values are stored encrypted and mounted as files inside the container.

```yaml
# docker-compose.yml (Swarm mode)
secrets:
    db_password:
        file: ./srcs/secrets/db_password.txt

services:
    database:
        secrets: [db_password]
        environment:
            POSTGRES_PASSWORD_FILE: /run/secrets/db_password
```

Read the secret in your application:

```python
# Python example
with open(os.environ['POSTGRES_PASSWORD_FILE']) as f:
    password = f.read().strip()
```

### Secrets directory

`srcs/secrets/` is listed in `.gitignore`. Place secret files here when using Docker Secrets. Never commit the contents.

---

## Secure HTTP Headers

The Nginx configuration sets the following security headers on all responses:

| Header                      | Value                                 | Purpose                   |
| --------------------------- | ------------------------------------- | ------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Force HTTPS for 2 years   |
| `X-Frame-Options`           | `DENY`                                | Prevent clickjacking      |
| `X-Content-Type-Options`    | `nosniff`                             | Prevent MIME sniffing     |
| `X-XSS-Protection`          | `1; mode=block`                       | Legacy XSS filter         |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`     | Limit referrer leakage    |
| `Content-Security-Policy`   | See nginx config                      | Restrict resource origins |

---

## Container Hardening

- **Minimal base images:** Alpine Linux (~5 MB) instead of Debian/Ubuntu reduces the attack surface.
- **No SSH:** Containers are accessed via `docker exec` or logs. No SSH daemon runs inside containers.
- **Read-only mounts:** The `nginx_ssl` volume is mounted `:ro` (read-only) in the reverse proxy.
- **No privileged mode:** No container uses `privileged: true` or `cap_add`.
- **Docker socket access:** Only Portainer mounts the Docker socket — and it is read-only. Portainer is disabled in production.

---

## Least Privilege Principles

| Principle                             | Implementation                               |
| ------------------------------------- | -------------------------------------------- |
| Only expose necessary ports           | Only Nginx exposes ports 80/443 to the host  |
| Internal services are unreachable     | database and redis have no host port mapping |
| Read-only file systems where possible | SSL volume is mounted `:ro`                  |
| Separate network zones                | frontend_network / backend_network isolation |
| Non-root processes                    | All app containers run as unprivileged users |
| Minimal OS packages                   | Alpine images; only install what is needed   |

---

## Authentication Identities And Account Linking

Authentication methods are stored separately from player progress in
`auth_identities`. Each persistent user may have at most one `shellsmash` and
one active `forty_two` identity. ShellSmash email addresses are normalised to
lower case and passwords are stored only as salted scrypt hashes. Provider
subjects, password hashes, and ShellSmash email addresses are never included in
account previews.

The migration `20260716000000-create-auth-identities-account-conflicts` copies
legacy password, Google, and 42 identifiers into the new table without removing
the old columns. The retained Google records are historical data only: no
Google strategy, route, credential, or account-link control is exposed. This
preserves existing account data while making 42 the only remote provider.
Local and WebSocket authentication resolve old user IDs through pending
conflicts and completed merges before authorising application operations.

All account-link mutations require a valid JWT, the double-submit CSRF token,
and a per-IP rate-limit allowance. Removing the final authentication method is
rejected. ShellSmash accounts are never linked by an email match: an existing
account can only be linked after its password has been verified.

42 authorisation requests carry 256 bits of random `state`. The state payload
is stored in Redis for ten minutes and consumed atomically with `GETDEL` at
callback time, which makes it expiring and single-use. A Redis failure fails
the OAuth flow closed.

Account consolidation locks the conflict, both users, and their identities in
one database transaction. Duplicate methods must be removed first, and a
consolidation is rejected while either account is queued or has a pending or
active match. The selected account's progress is retained without combining
balances or inventories. Reports, match history, messages, and casino audit
records remain attached to an internal tombstone for moderation and antifraud
purposes; user-facing progress and social membership belonging to the discarded
account are removed.

---

## REST Documentation And Request Authentication

Nginx protects the complete `/api/docs*` family with `auth_request`. Its
internal probe runs the normal session and guest guards: anonymous clients are
rejected with `401`, guest accounts with `403`, and only registered accounts may
load Scalar, the local Scalar bundle, or the JSON and YAML contracts. The probe
itself is hidden from external routing and excluded from OpenAPI.

The OpenAPI security schemes mirror runtime behaviour. Internal API operations
use the HTTP-only `auth_token` cookie, public API mutations use `X-API-Key`, and
metrics use their dedicated bearer token. Safe public API methods (`GET`,
`HEAD`, and `OPTIONS`) require no API key. Public keys are compared in constant
time and Scalar never preconfigures or persists them.

A global guard validates the double-submit CSRF cookie and header for every
state-changing request carrying an authentication cookie. Login, registration,
guest-session creation, and the public API retain their explicit policies.
Scalar sends cookies with every request and obtains a fresh token immediately
before each internal `POST`, `PUT`, `PATCH`, or `DELETE` request.

---

## Monitoring (Prometheus + Grafana)

### Grafana auth model

Grafana is served exclusively behind Nginx at `/monitoring/`
(`GF_SERVER_SERVE_FROM_SUB_PATH=true`) — it has no published host port, so it
is unreachable except through the reverse proxy over HTTPS. Sign-up
(`GF_USERS_ALLOW_SIGN_UP=false`) and anonymous access
(`GF_AUTH_ANONYMOUS_ENABLED=false`) are both disabled, so the Vault-seeded
admin account (`GF_ADMIN_USER` / `GF_ADMIN_PASSWORD`, from
`kv/transcendence/dev/monitoring`) is the only way in. `infra/monitoring/tools/entrypoint.sh`
refuses to start Grafana at all if `GF_ADMIN_PASSWORD` is empty — it never
falls back to a default credential like `changeme` (previously a real gap,
tracked as defect D5, now fixed: booting with a known password behind a
now-public route would have been a real hole).

### Metrics token flow

`GET /api/metrics` (the Prometheus text-format endpoint on the backend)
requires `Authorization: Bearer <METRICS_TOKEN>` when `METRICS_TOKEN` is
configured. The token itself never touches `prometheus.yml` or process
arguments: Vault renders it to `/vault/secrets/monitoring.env`, the monitoring
container's entrypoint writes it to a mode-`400` file
(`/etc/prometheus/metrics_token`), and Prometheus reads it via
`authorization.credentials_file`. The controller compares the presented
token with `crypto.timingSafeEqual` on length-matched buffers (defect D7) —
a plain `!==` comparison leaks timing information proportional to the number
of matching leading bytes, which is enough for an attacker to recover the
token character by character over many requests.

If `METRICS_TOKEN` is unset, `/api/metrics` is unauthenticated. That is only
acceptable in a throwaway local environment; `vault-seed-dev.sh` always
generates one, so a normal `make dev` run is protected by default.

### Why `/api/health` is public

`/api/health` (through the Nginx `/api/` location) performs a live DB + Redis
probe on every hit and returns 503 naming which dependency is down. It's
intentionally public because it doubles as the Docker `HEALTHCHECK` target
and needs to work from outside the container network for external uptime
checks. It's covered by the same `limit_req zone=api_limit` as the rest of
`/api/`, which bounds how often it can be hit. Revealing *which* dependency
failed is a deliberate trade-off for this project (faster debugging during
evaluation) rather than a hardened production stance — a public-facing
deployment would want to collapse the 503 body to a generic message.

### `modsecurity off` on `/monitoring/`

The `/monitoring/` Nginx location disables ModSecurity
(`modsecurity off;`), matching the existing `/` and `/api/auth/*/callback`
locations. Grafana's own API traffic (JSON bodies, its internal query
language in request params) trips generic OWASP CRS rules with false
positives, and Grafana already enforces its own authentication and
authorization on every request — ModSecurity would be redundant defense
against a threat model (SQLi/XSS payloads reaching an app server) that
doesn't apply to a pre-authenticated dashboard UI. `/api/` and `/admin/`
(the two locations that accept arbitrary user-controlled input into
business logic) keep ModSecurity enabled.

### Exporter credentials

`postgres_exporter` and `redis_exporter` never receive credentials as compose
environment literals. Each mounts the existing Vault-rendered secret volume
for its target service read-only (`database_vault_rendered` /
`redis_vault_rendered`) and assembles its connection string at container
start via a small wrapper entrypoint. `postgres_exporter` authenticates as a
dedicated `monitoring` Postgres role granted `pg_monitor` (read-only
observability views), created by `infra/database/tools/init/01-monitoring-role.sh`
on first database init — never the Postgres superuser.

---

## Environment Variable Security Checklist

- [ ] `.env` is in `.gitignore` — never committed
- [ ] All default passwords in `.env.example` are clearly marked as placeholders
- [ ] `SECRET_KEY` and `JWT_SECRET` are generated with `openssl rand -hex 32`
- [ ] `POSTGRES_PASSWORD` is at least 20 characters
- [ ] `REDIS_PASSWORD` is set (empty password disables auth)
- [ ] `GF_ADMIN_PASSWORD` is changed from the default
