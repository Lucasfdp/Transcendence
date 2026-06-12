# Security

Security considerations for the ft_transcendence Docker infrastructure.

---

## TLS / HTTPS

The project enforces HTTPS exclusively. HTTP requests receive a 301 redirect.

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

| Attack scenario | Mitigation |
|----------------|------------|
| Compromised frontend | Frontend is on `frontend_network` only — cannot reach `database` or `redis` |
| Compromised Nginx | Nginx has no credentials and no direct DB connection |
| Brute-force on Redis | Redis is not on `frontend_network`; only backend can reach it |
| Port scan from internet | Only ports 80 and 443 are exposed on the host |

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

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Force HTTPS for 2 years |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Content-Security-Policy` | See nginx config | Restrict resource origins |

---

## Container Hardening

- **Minimal base images:** Alpine Linux (~5 MB) instead of Debian/Ubuntu reduces the attack surface.
- **No SSH:** Containers are accessed via `docker exec` or logs. No SSH daemon runs inside containers.
- **Read-only mounts:** The `nginx_ssl` volume is mounted `:ro` (read-only) in the reverse proxy.
- **No privileged mode:** No container uses `privileged: true` or `cap_add`.
- **Docker socket access:** Only Portainer mounts the Docker socket — and it is read-only. Portainer is disabled in production.

---

## Least Privilege Principles

| Principle | Implementation |
|-----------|---------------|
| Only expose necessary ports | Only Nginx exposes ports 80/443 to the host |
| Internal services are unreachable | database and redis have no host port mapping |
| Read-only file systems where possible | SSL volume is mounted `:ro` |
| Separate network zones | frontend_network / backend_network isolation |
| Non-root processes | All app containers run as unprivileged users |
| Minimal OS packages | Alpine images; only install what is needed |

---

## Environment Variable Security Checklist

- [ ] `.env` is in `.gitignore` — never committed
- [ ] All default passwords in `.env.example` are clearly marked as placeholders
- [ ] `SECRET_KEY` and `JWT_SECRET` are generated with `openssl rand -hex 32`
- [ ] `POSTGRES_PASSWORD` is at least 20 characters
- [ ] `REDIS_PASSWORD` is set (empty password disables auth)
- [ ] `GF_ADMIN_PASSWORD` is changed from the default
