# Shell Smash — Monitoring Stack Implementation Prompt

## Context

You are a senior DevOps/backend engineer implementing a production-grade monitoring stack for **Shell Smash**, a multiplayer browser game built as a 42-school ft_transcendence project.

### Current state

- **Backend**: NestJS 10 on port 8000, PostgreSQL 16, Redis 7, Nginx reverse proxy
- **Monitoring placeholder**: A single Alpine container that does nothing. The `docker-compose.yml` already has a `monitoring` service wired to both networks with `GF_ADMIN_USER`, `GF_ADMIN_PASSWORD`, `PROMETHEUS_SCRAPE_INTERVAL` env vars injected from `.env`
- **Healthcheck in docker-compose** expects `http://localhost:3001/` to return 200 (Grafana's default port)
- **Volume**: `monitoring_data` is mounted to `/var/lib/monitoring`
- **Log volume**: `logs` is mounted to `/var/log/monitoring`

### Existing `.env` variables already available

```
MONITORING_PORT=3001
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=grafana_dev_pass
PROMETHEUS_SCRAPE_INTERVAL=15s
```

---

## What to implement

Replace the placeholder monitoring container with a real observability stack. The result must be **fully provisioned on first boot** — no manual Grafana UI clicks required.

### Architecture

Run **two processes** inside the single `monitoring` container using **supervisord**:

1. **Prometheus** on port `9090` (internal only, not exposed outside the container)
2. **Grafana** on port `3001` (mapped to `MONITORING_PORT`)

Rationale: the project has a single `monitoring` service in `docker-compose.yml`. Adding more services requires coordinating with teammates. Supervisord inside one container is the pragmatic choice for a school project.

> **Alternative (preferred if teammates agree):** Split into `monitoring` (Grafana) and `prometheus` services. If you split, also add `postgres_exporter` and `redis_exporter` as separate named services so each has a clear responsibility.

---

## Required deliverables

### 1. Replace `srcs/requirements/monitoring/Dockerfile`

Use a multi-stage approach:

- **Stage 1**: Download Prometheus binary from the official GitHub release (not via apk — Alpine's package is outdated). Verify the SHA256 checksum.
- **Stage 2**: Base on `grafana/grafana:10-alpine`. Copy the Prometheus binary in. Install `supervisor` via apk. Wire everything together.

The final image must run as a non-root user where possible (Grafana already does this; Prometheus needs its data dir owned by the grafana user or a dedicated user).

### 2. Prometheus configuration — `srcs/requirements/monitoring/conf/prometheus.yml`

Scrape the following targets (all internal Docker DNS names):

| Job          | Target           | Notes                                               |
| ------------ | ---------------- | --------------------------------------------------- |
| `backend`    | `backend:8000`   | NestJS `/api/metrics` endpoint (see §4)             |
| `postgres`   | `database:5432`  | Via `postgres_exporter` binary bundled in the image |
| `redis`      | `redis:6379`     | Via `redis_exporter` binary bundled in the image    |
| `prometheus` | `localhost:9090` | Self-scrape                                         |

Use `${PROMETHEUS_SCRAPE_INTERVAL}` as the global `scrape_interval` (pass it in via environment variable substitution or a templated entrypoint).

Security: Prometheus binds to `127.0.0.1:9090` so it is not reachable from outside the container. Only Grafana (same process group) can query it.

### 3. Grafana auto-provisioning

Place config files in the image under `/etc/grafana/provisioning/`:

**`datasources/prometheus.yml`**

```yaml
apiVersion: 1
datasources:
    - name: Prometheus
      type: prometheus
      url: http://localhost:9090
      isDefault: true
      access: proxy
```

**`dashboards/provider.yml`**

```yaml
apiVersion: 1
providers:
    - name: default
      type: file
      options:
          path: /var/lib/grafana/dashboards
```

**Dashboard JSON files** (place in `/var/lib/grafana/dashboards/` in the image):

1. `shellsmash-overview.json` — top-level: HTTP req/s, P95 latency, active users (from NestJS metrics), error rate (4xx/5xx split)
2. `shellsmash-infra.json` — Postgres connections/queries, Redis memory/ops, container CPU/memory via cAdvisor metrics if available, otherwise process metrics from NestJS

Use Grafana's `__inputs` and `__requires` fields so dashboards are portable. Set `uid` explicitly so they don't duplicate on restart.

### 4. NestJS backend — add Prometheus metrics endpoint

Install: `prom-client` (no NestJS wrapper needed — use it directly for simplicity and fewer dependencies).

**`GET /api/metrics`** — returns Prometheus text format. Gate behind `NODE_ENV !== 'production'` OR require a bearer token set via `METRICS_TOKEN` env var (preferred for production safety).

Collect:

- Default Node.js metrics via `collectDefaultMetrics()` (event loop lag, heap, GC, etc.)
- HTTP request counter: `http_requests_total` with labels `method`, `route`, `status_code`
- HTTP request duration histogram: `http_request_duration_seconds` with labels `method`, `route`
- Active WebSocket connections gauge (if applicable later)
- Guest session count gauge (query the DB periodically, update every 60s)

Implement the HTTP metrics via a **NestJS interceptor** (`MetricsInterceptor`) registered globally in `main.ts`. The interceptor records start time, waits for the response, then increments the counter and observes the histogram.

Add a dedicated `MetricsModule` with `MetricsController` and `MetricsService`. The controller has a single `GET /metrics` route. The service owns the prom-client registry and exposes `register.metrics()`.

**Health endpoint** (already referenced in the backend Dockerfile healthcheck but not yet implemented):

`GET /api/health` — returns `{ status: 'ok', uptime: number, db: 'up'|'down', redis: 'up'|'down' }`. Check DB with a simple `SELECT 1`, check Redis with `PING`. Return `200` if both are up, `503` if either is down. Use `@nestjs/terminus` for this (`HealthModule`).

### 5. Supervisord configuration — `srcs/requirements/monitoring/conf/supervisord.conf`

```ini
[supervisord]
nodaemon=true
logfile=/var/log/monitoring/supervisord.log
pidfile=/tmp/supervisord.pid

[program:prometheus]
command=/usr/local/bin/prometheus
  --config.file=/etc/prometheus/prometheus.yml
  --storage.tsdb.path=/var/lib/monitoring/prometheus
  --storage.tsdb.retention.time=7d
  --web.listen-address=127.0.0.1:9090
  --web.enable-lifecycle
autostart=true
autorestart=true
stdout_logfile=/var/log/monitoring/prometheus.log
stderr_logfile=/var/log/monitoring/prometheus.log

[program:grafana]
command=/run.sh
environment=GF_PATHS_DATA=/var/lib/monitoring/grafana,GF_PATHS_LOGS=/var/log/monitoring
autostart=true
autorestart=true
stdout_logfile=/var/log/monitoring/grafana.log
stderr_logfile=/var/log/monitoring/grafana.log
```

### 6. Entrypoint — `srcs/requirements/monitoring/tools/entrypoint.sh`

```sh
#!/bin/sh
set -e

# Substitute PROMETHEUS_SCRAPE_INTERVAL into prometheus.yml at runtime
sed "s/\${PROMETHEUS_SCRAPE_INTERVAL}/${PROMETHEUS_SCRAPE_INTERVAL:-15s}/g" \
    /etc/prometheus/prometheus.yml.tpl > /etc/prometheus/prometheus.yml

# Configure Grafana admin credentials from env
export GF_SECURITY_ADMIN_USER="${GF_ADMIN_USER:-admin}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_ADMIN_PASSWORD:-changeme}"
export GF_SERVER_HTTP_PORT="${MONITORING_PORT:-3001}"
export GF_ANALYTICS_REPORTING_ENABLED=false
export GF_ANALYTICS_CHECK_FOR_UPDATES=false

exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
```

---

## Security requirements (enforced by your personal code standards)

- **No hardcoded secrets** anywhere. All passwords come from env vars.
- The `GET /api/metrics` endpoint must either be IP-restricted (only `monitoring` container subnet) or require `Authorization: Bearer ${METRICS_TOKEN}` where `METRICS_TOKEN` defaults to a long random string generated at container start if not provided.
- Prometheus does not listen on a public interface — `127.0.0.1:9090` only.
- Grafana `GF_SECURITY_DISABLE_GRAVATAR=true`, `GF_SECURITY_COOKIE_SECURE=true` (in production).
- Add `METRICS_TOKEN` to `.env.example` with a comment: `# Required — set a long random string. Generate with: openssl rand -hex 32`.

---

## docker-compose changes required

Update the `monitoring` service in `srcs/docker-compose.yml`:

```yaml
monitoring:
    build:
        context: ./requirements/monitoring
        dockerfile: Dockerfile
    container_name: ${COMPOSE_PROJECT_NAME}_monitoring
    image: ${COMPOSE_PROJECT_NAME}/monitoring:latest
    restart: unless-stopped
    ports:
        - "${MONITORING_PORT:-3001}:${MONITORING_PORT:-3001}" # Grafana — localhost only ideally
    expose:
        - "${MONITORING_PORT:-3001}"
    volumes:
        - monitoring_data:/var/lib/monitoring
        - logs:/var/log/monitoring
    networks:
        - frontend_network
        - backend_network
    environment:
        - GF_ADMIN_USER=${GF_ADMIN_USER:-admin}
        - GF_ADMIN_PASSWORD=${GF_ADMIN_PASSWORD:-changeme}
        - PROMETHEUS_SCRAPE_INTERVAL=${PROMETHEUS_SCRAPE_INTERVAL:-15s}
        - MONITORING_PORT=${MONITORING_PORT:-3001}
        - METRICS_TOKEN=${METRICS_TOKEN}
    depends_on:
        backend:
            condition: service_healthy
        database:
            condition: service_healthy
        redis:
            condition: service_healthy
    healthcheck:
        test:
            [
                "CMD",
                "wget",
                "--quiet",
                "--tries=1",
                "--spider",
                "http://localhost:${MONITORING_PORT:-3001}/api/health",
            ]
        interval: 30s
        timeout: 10s
        retries: 5
        start_period: 60s # Grafana + Prometheus both need time to init
```

Also add `METRICS_TOKEN` to the backend service environment.

---

## `.dockerignore` for monitoring

```
*.md
.git
```

---

## Testing checklist

- [ ] `make re` — all containers reach `healthy` state including `monitoring`
- [ ] `https://localhost/monitoring` or `http://localhost:3001` → Grafana login page appears
- [ ] Login with `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD` → dashboards pre-loaded, no manual setup
- [ ] `https://localhost/api/metrics` with correct `Authorization` header → Prometheus text output
- [ ] `https://localhost/api/health` → `{"status":"ok","db":"up","redis":"up"}`
- [ ] Grafana "Shell Smash Overview" dashboard shows live data within 30s of backend receiving requests
- [ ] Prometheus target page (`http://localhost:9090/targets` from inside the container) shows all targets `UP`
- [ ] `docker compose stop backend && sleep 35` → Grafana shows backend as down; restart → recovers
- [ ] Grafana dashboard survives `docker compose restart monitoring` (data persisted in `monitoring_data` volume)

---

## File structure to create

```
srcs/requirements/monitoring/
├── Dockerfile
├── conf/
│   ├── supervisord.conf
│   ├── prometheus.yml.tpl          ← template; entrypoint envsubsts this to prometheus.yml
│   └── grafana/
│       └── provisioning/
│           ├── datasources/
│           │   └── prometheus.yml
│           └── dashboards/
│               ├── provider.yml
│               ├── shellsmash-overview.json
│               └── shellsmash-infra.json
└── tools/
    └── entrypoint.sh

srcs/requirements/backend/src/src/
├── metrics/
│   ├── metrics.module.ts
│   ├── metrics.controller.ts
│   ├── metrics.service.ts
│   └── metrics.interceptor.ts
└── health/
    ├── health.module.ts
    └── health.controller.ts
```

---

## Notes for the implementer

- Prometheus binary for `linux/amd64`: download from `https://github.com/prometheus/prometheus/releases`. Pin to a specific version (e.g. `2.51.2`). Verify SHA256. Do not use Alpine's `apk` package — it lags behind releases.
- `grafana/grafana:10-alpine` already has an entrypoint at `/run.sh` — supervisor calls it directly.
- Dashboard JSON can be generated by building the dashboards in Grafana UI first, then exporting with "Export for sharing externally" and committing the JSON. Alternatively write them by hand using the Grafana dashboard JSON schema.
- For the `prom-client` interceptor: capture `req.route?.path ?? req.path` as the `route` label to avoid high cardinality from IDs in URLs (e.g. `/api/users/123` → `/api/users/:id`).
- The `health` module should use `@nestjs/terminus` — add it to `dependencies` (not devDependencies) in `package.json`.
- `synchronize: true` in TypeORM is fine for dev but ensure it's `false` in production — it's already gated correctly in `app.module.ts`.
