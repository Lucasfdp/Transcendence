# Monitoring Module — Completion Plan (Prometheus + Grafana)

Status: plan approved, pending implementation.
Scope: **Major — Monitoring with Prometheus and Grafana** (`docs/en.subject.md` §IV, lines 476–481) and only that module.
Audience: the agent/teammate implementing this. No code has been changed yet; this document is the full work order.

Decisions already taken (by Lucas, 2026-07-11):

| Decision | Choice |
|---|---|
| Grafana exposure | Nginx subpath `https://localhost:42424/monitoring/` |
| Alerting | Grafana-managed alerts, file-provisioned |
| Exporters | **Team decides at implementation time** — both options specified in Phase 4 (Option A: postgres+redis, Option B: full set) |

Subject requirement → current state:

| Requirement | State |
|---|---|
| Collect metrics with Prometheus | ✅ Working (prom-client + scrape) |
| Configure exporters and integrations | ❌ Only backend self-instrumentation |
| Create custom Grafana dashboards | 🟡 2 dashboards exist; 1 broken panel; will need exporter panels |
| Set alerting rules | ❌ Nothing exists |
| Secure Grafana access | ❌ Grafana is currently **unreachable** from outside Docker |

---

## Part 1 — Defects found (fix all of these)

### D1 (BLOCKER) — Grafana is unreachable
`docker-compose.yml` (monitoring service) says *"Grafana is proxied through Nginx — do not expose directly on host"*, but `infra/reverse-proxy/conf/default.conf.template` has **no** location for it, and no compose file maps port 3001 to the host. The stack runs and scrapes but nobody can open a dashboard. Fixed by Phase 2.

Related doc bugs: `docs/service-map.md` line ~110 lists monitoring on port **3000** (it is 3001); the compose comment is currently false.

### D2 (BLOCKER) — Error responses recorded as status_code="200"
`backend/src/modules/metrics/metrics.interceptor.ts`, `record()` reads `res.statusCode` in the `tap({ error })` branch. At that point the exception filter has **not** run yet, so `res.statusCode` is still 200. Every thrown `HttpException` (validation 400s, 401, 403, 404-from-handler, 500) is counted as `200`. The 4xx/5xx dashboard panels and any error-rate alert are blind to most real errors.

Fix: in the error branch, derive the status from the exception, not the response:

- `err instanceof HttpException ? err.getStatus() : 500`
- Keep the success branch as-is (`res.statusCode` is correct there).
- Note: NestJS global interceptors do not run for unmatched routes, so router-404s will still not be counted. Acceptable; do not try to fix by moving to raw Express middleware unless the team wants router-404 visibility (if so: record on `res.once("finish")` in a middleware registered before the router, using `req.route?.path ?? "unmatched"`).

### D3 (BLOCKER) — "Process Uptime" panel shows No data
`infra/monitoring/conf/grafana/provisioning/dashboards/shellsmash-infra.json`, panel id 8 queries `process_uptime_seconds`. prom-client 15 does not export that metric (verified against `node_modules/prom-client/lib/metrics/` — only `processStartTime.js` → `process_start_time_seconds` exists).

Fix: change expr to `time() - process_start_time_seconds`.

### D4 — entrypoint crash-loops if METRICS_TOKEN missing from the env file
`infra/monitoring/tools/entrypoint.sh` uses `set -eu`, then line 48 tests `[ -n "${METRICS_TOKEN}" ]`. If the Vault-rendered env file ever lacks that line (template error, partial render), the script dies with *unbound variable* instead of reaching its own warning branch.

Fix: use `${METRICS_TOKEN:-}` in the test (same for any other optional var referenced under `set -u`).

### D5 — Grafana admin password silently falls back to "changeme"
`entrypoint.sh` line 68: `GF_SECURITY_ADMIN_PASSWORD="${GF_ADMIN_PASSWORD:-changeme}"`. If Vault rendering ever produces an empty value, Grafana boots with a known default password behind what will now be a public route.

Fix: fail hard — if `${GF_ADMIN_PASSWORD:-}` is empty, log an error and `exit 1` (mirrors the existing missing-env-file behavior). Never default a credential.

### D6 — Container reports healthy while Prometheus is dead
supervisord `startretries=3` → after 3 failed starts Prometheus goes FATAL and stays down; the Docker healthcheck only probes Grafana (`/api/health`), so the container remains "healthy" while every panel flatlines.

Fix: extend the healthcheck (Dockerfile and compose) to probe both:
`wget -q --spider http://localhost:${MONITORING_PORT:-3001}/api/health && wget -q --spider http://127.0.0.1:9090/-/healthy`.

### D7 — Metrics token comparison is not constant-time
`metrics.controller.ts`: `provided !== token`. Use `crypto.timingSafeEqual` on equal-length buffers (guard length mismatch first, then compare). Low practical risk, cheap fix, good answer in an eval.

### D8 — Label-cardinality risk in interceptor fallback
`metrics.interceptor.ts` line 49 falls back to `req.path` when `req.route` is undefined. Any code path that hits the fallback creates one Prometheus series per unique URL (unbounded).

Fix: replace the fallback with the constant `"unmatched"`.

### D9 — Gauge misnamed with `_total` suffix
`shellsmash_guest_sessions_total` is a Gauge; the `_total` suffix conventionally marks counters and trips `promtool` lint.

Fix: rename to `shellsmash_guest_sessions` in `metrics.service.ts` **and** in `shellsmash-overview.json` panel id 8 (they must change together).

### D10 — Redis health check: comment/behaviour mismatch + edge cases
`backend/src/modules/health/redis.health.ts`:
- The doc comment says "AUTH … followed by PING", but the password path returns success after `+OK` to AUTH and never sends PING. Either send PING after AUTH or fix the comment (sending PING is preferred — AUTH success proves auth, PING proves the server serves commands).
- If Redis has **no** password configured but `REDIS_PASSWORD` is set in env, AUTH returns `-ERR` and health fails — acceptable, but worth a comment.
- `socket.once("data")` assumes the whole RESP reply arrives in one chunk. True in practice for `+OK`/`+PONG`; leave as-is but add a comment, or accumulate until `\r\n`.

### D11 — Prometheus `--web.enable-lifecycle` is enabled
`infra/monitoring/conf/supervisord.conf`. Allows unauthenticated POST `/-/reload` and `/-/quit`. It is bound to 127.0.0.1 inside the container so exposure is minimal, but it is unused — remove the flag (defense in depth; also one less thing to explain in the security eval).

### D12 — No tests at all for metrics/health modules
There is no `*.spec.ts` under `backend/src/modules/metrics/` or `backend/src/modules/health/`. Required specs are listed in Phase 6.

### Minor notes (fix opportunistically, don't block on them)
- `datasources/prometheus.yml` hardcodes `timeInterval: "15s"`; if `PROMETHEUS_SCRAPE_INTERVAL` is changed, Grafana's min-interval no longer matches. Acceptable; add a comment cross-referencing the env var.
- Heap gauge in the infra dashboard hardcodes `max: 512000000`. Cosmetic.
- Scrape target `backend:8000` is hardcoded while the backend reads `BACKEND_PORT` (default 8000). If the port is ever changed, scraping silently breaks. Optionally template it in `prometheus.yml.tpl` like the scrape interval.
- The guest-sessions poll runs raw SQL against `"users"."isGuest"`. Production uses `synchronize: false` + migrations, and no migration in `backend/src/migrations/` creates the users table/column — verify the prod schema story before demo day (out of scope for this module, but the gauge dies quietly if the column is absent; it only logs a warning every 60 s).
- `/api/health` is public (through the nginx `/api/` location) and triggers a live DB + Redis probe per hit. It is rate-limited by `api_limit`; acceptable, but be ready to justify it. It also reveals which dependency is down in the 503 body — acceptable for this project, note it in `docs/security.md`.

---

## Part 2 — Completion work

Implementation order: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7. Phases 2–4 are independent of each other after Phase 1.

### Phase 1 — Fix defects
Apply D2–D11 above. Small, surgical diffs; keep the existing tab-width-4 formatting and current file layout. D1 and D3 are handled structurally in Phases 2 and 5.

### Phase 2 — Expose Grafana at `/monitoring/` behind Nginx (decision: subpath)

1. **Grafana config** — in `entrypoint.sh` add:
   - `export GF_SERVER_ROOT_URL="%(protocol)s://%(domain)s/monitoring/"`
   - `export GF_SERVER_SERVE_FROM_SUB_PATH="true"`
   - `export GF_USERS_ALLOW_SIGN_UP="false"`
   - `export GF_AUTH_ANONYMOUS_ENABLED="false"`
   - Set `GF_SECURITY_COOKIE_SECURE` default to `true` (everything is behind HTTPS now; keep env override).
2. **Nginx** — new location in `default.conf.template`:

   ```nginx
   location /monitoring/ {
       modsecurity off;                 # Grafana's API traffic trips generic CRS rules; auth is Grafana's own
       proxy_pass         http://monitoring:3001;
       proxy_set_header   Host                $http_host;
       proxy_set_header   X-Real-IP           $remote_addr;
       proxy_set_header   X-Forwarded-For     $proxy_add_x_forwarded_for;
       proxy_set_header   X-Forwarded-Proto   $scheme;
       proxy_http_version 1.1;
       proxy_set_header   Upgrade             $http_upgrade;   # /monitoring/api/live/ websocket
       proxy_set_header   Connection          $connection_upgrade;
       proxy_read_timeout 120s;
       limit_req zone=api_limit burst=30 nodelay;              # brute-force mitigation on /login
       limit_req_status 429;
   }
   ```

   Notes for the implementer:
   - Grafana with `serve_from_sub_path=true` expects the `/monitoring/` prefix to be **kept** — `proxy_pass http://monitoring:3001;` (no trailing path) does exactly that. Do not write `proxy_pass http://monitoring:3001/;`.
   - Do **not** add `add_header` inside this location: nginx location-level `add_header` replaces ALL server-level headers (HSTS, CSP…). The server-level headers are fine for Grafana 10 (CSP already allows `unsafe-inline`; websockets are covered by `'self'`/`wss://localhost:42424` in connect-src).
   - `X-Frame-Options DENY` at server level also applies — fine, we do not embed Grafana in iframes.
3. **Classic failure modes to verify** (all caused by subpath misconfig): redirect loop on `/monitoring/login`, 404s on `/monitoring/public/*` assets, websocket errors in the browser console from `/monitoring/api/live/ws`.
4. **Docs**: fix `docs/service-map.md` (port 3001, access URL), add access instructions to `docs/deployment.md`, and note the auth model in `docs/security.md` (admin user from Vault, no sign-up, no anonymous).

### Phase 3 — Alerting (decision: Grafana-managed, file-provisioned)

1. Create `infra/monitoring/conf/grafana/provisioning/alerting/` with:
   - `alerts.yml` — the rule group (`apiVersion: 1`, `groups:`), folder **"Shell Smash Alerts"**, evaluation interval 1m, datasource uid `prometheus` (already stable).
   - Optional `contactpoints.yml` + `policies.yml` — a webhook contact point can be added later; without one, rules still evaluate and show state in the UI, which satisfies "set alerting rules". If teammates want notifications with zero external deps, a webhook pointing at a request-bin style container is the cheapest demo.
2. The Dockerfile already copies `conf/grafana/provisioning` wholesale — no Dockerfile change needed beyond the new files existing.
3. Starter rule set (tune thresholds against real dev traffic before freezing):

   | Alert | Expr (summary) | For |
   |---|---|---|
   | BackendDown | `up{job="backend"} == 0` | 1m |
   | High5xxRate | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) > 0.5` | 5m |
   | HighP95Latency | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 1` | 10m |
   | EventLoopLagP99 | `nodejs_eventloop_lag_p99_seconds > 0.2` | 5m |
   | HeapNearLimit | `nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes > 0.9` | 10m |
   | PrometheusTargetMissing | `up == 0` (any job) | 2m |

   If Phase 4 exporters are added: `PostgresDown` (`pg_up == 0`), `RedisDown` (`redis_up == 0`), `PGConnectionsHigh` (`pg_stat_activity_count / pg_settings_max_connections > 0.8`).
4. **Important**: High5xxRate depends on defect **D2** being fixed — otherwise 5xx are recorded as 200 and the alert can never fire. Demo script: stop the database (`docker stop <project>_database`), watch BackendDown/High5xxRate transition Pending → Firing.

### Phase 4 — Exporters (team decides between A and B at implementation time)

Common to both options:
- Each exporter is a new compose service on `backend_network` only, `expose`-only (no host ports), scraped by adding a job to `prometheus.yml.tpl`.
- Credentials must flow through the existing Vault-agent pattern — never compose env literals. Cheapest route: mount the existing rendered secret volumes read-only (`database_vault_rendered`, `redis_vault_rendered`) and point the exporter's env-file/entrypoint at them; cleaner route: dedicated ctmpl per exporter.
- Add one Grafana dashboard per exporter (or one "Data Stores" dashboard) — bake JSON into the image like the existing two.

**Option A — postgres_exporter + redis_exporter (recommended, ~½ day)**

| | |
|---|---|
| Images | `quay.io/prometheuscommunity/postgres-exporter` (pin a version), `oliver006/redis_exporter` (pin) |
| Postgres auth | Preferred: dedicated read-only role — `CREATE USER monitoring …; GRANT pg_monitor TO monitoring;` seeded via `scripts/vault-seed-dev.sh` + init SQL. Acceptable fallback: reuse the postgres superuser password from the rendered secret (weaker; justify or avoid). |
| Redis auth | `REDIS_ADDR=redis://redis:6379`, `REDIS_PASSWORD` from rendered secret |
| Scrape jobs | `postgres` → `postgres_exporter:9187`, `redis` → `redis_exporter:9121` |
| Pros | Monitors the two stateful services (the evaluator question is always "how do you know the DB is healthy?"); tiny official images; 2 containers |
| Cons | Postgres monitoring role is a small extra seeding step; 2 more vault touchpoints |

**Option B — Full set: Option A + nginx exporter + node-exporter (± cadvisor) (~1½–2 days)**

| | |
|---|---|
| nginx | Add internal-only `location /stub_status` (allow only Docker network) + `nginx/nginx-prometheus-exporter` container → job `nginx:9113` |
| Host | `prom/node-exporter` with `/proc`, `/sys`, `/` read-only mounts → job `node:9100` |
| Containers | `gcr.io/cadvisor/cadvisor` — **needs privileged mounts (`/var/run/docker.sock`, `/sys`, `/var/lib/docker`)**; this is a genuine security trade-off in a project that has been careful about exactly that. If chosen, document the justification in `docs/security.md`. Recommendation: skip cadvisor, keep node-exporter. |
| Pros | Edge + host visibility, most impressive coverage |
| Cons | ~4 extra containers, more scrape jobs/dashboards/alerts to maintain and defend, cadvisor privilege question |

Either option satisfies "configure exporters and integrations". Option A is the floor; do not ship "None".

### Phase 5 — Dashboard polish
1. Fix D3 (uptime expr) and rename the guest gauge (D9) in `shellsmash-overview.json`.
2. Add panels for whichever exporters Phase 4 ships (DB connections, cache hit ratio, Redis memory/clients; nginx rps and 4xx/5xx at the edge if Option B).
3. Keep dashboard `uid`s stable (`shellsmash-overview`, `shellsmash-infra`); bump `version`.
4. Optional but cheap: a "Monitoring self" row — `up` per job as a state timeline, so target health is visible at a glance.

### Phase 6 — Tests and verification

Backend unit tests (new files, Jest, descriptive names, follow existing `*.spec.ts` style):
- `metrics.controller.spec.ts` — returns metrics with valid Bearer token; **throws UnauthorizedException on missing token**; **on wrong token**; serves unauthenticated when METRICS_TOKEN unset; content-type header matches registry.
- `metrics.interceptor.spec.ts` — records route template not raw path; **records 4xx/5xx status from thrown HttpException (regression test for D2)**; records 500 for non-HttpException errors; uses "unmatched" fallback (D8); skips non-http contexts.
- `metrics.service.spec.ts` — guest gauge set from DB count; poll failure logs warning and does not throw; timer cleared on destroy (no open-handle leak).
- `redis.health.spec.ts` — up on PONG; up on AUTH +OK→PONG; down on timeout / connection refused / -ERR reply (use a stub `net.Server`).
- Run `npm run test:cov`; keep ≥80 % on these modules; LCOV output is already configured.

Config validation:
- Add `promtool check config` against a rendered copy of `prometheus.yml.tpl` (render with default env in the Docker build: `RUN sed … | promtool check config /dev/stdin` or a two-step render+check). This catches YAML/scrape-config typos at build time instead of at container boot.

Manual validation checklist (record results in the PR/commit description):
1. `make dev` → all services healthy (`make health`).
2. `curl -k https://localhost:42424/api/metrics` → 401; with `Authorization: Bearer $TOKEN` → Prometheus text format.
3. Open `https://localhost:42424/monitoring/` → login page, no redirect loop, no console errors; log in with Vault-seeded admin credentials; sign-up absent.
4. Both dashboards render with data; uptime panel shows a value (D3 fixed).
5. Hit an endpoint that throws (e.g. bad body → 400) repeatedly → 4xx panel moves (D2 fixed).
6. `docker stop <project>_database` → `/api/health` returns 503 naming database; BackendDown/High5xxRate alert goes Pending → Firing in Grafana; restart DB, alert resolves.
7. `docker exec` into monitoring, `kill` the prometheus process 4× → container goes unhealthy (D6 fixed).
8. If exporters shipped: their targets show UP on the (internal) Prometheus targets page and panels have data.

### Phase 7 — Documentation closure (required by repo rules)
- `docs/modules-progress.md` — update the module entry: evidence (nginx route, alerting provisioning dir, exporters, dashboards, tests), status → `Done` once the checklist passes.
- `docs/service-map.md` — fix port 3001, add exporters if shipped, note the `/monitoring/` route.
- `docs/deployment.md` — Grafana access instructions (URL, where credentials come from: `make vault-seed-dev` seed file / Vault `kv/transcendence/dev/monitoring`).
- `docs/security.md` — Grafana auth model, metrics token flow (Vault → backend + Prometheus `credentials_file`), why `/api/health` is public, ModSecurity off for `/monitoring/` rationale.
- `AGENTS.md` — only if any workflow/convention changed (none expected).

---

## Acceptance criteria (module = Done when all true)
1. Every subject bullet demonstrably met: metrics collected, ≥1 real exporter integrated, ≥2 custom dashboards with live data, ≥5 provisioned alert rules visible/evaluating in Grafana, Grafana reachable only via HTTPS through nginx with Vault-managed admin credentials and sign-up/anonymous disabled.
2. Defects D1–D11 fixed; D12 covered by the new spec files with ≥80 % coverage on both modules.
3. Manual checklist in Phase 6 passes end-to-end from a clean `make fclean && make dev` (plus `make vault-bootstrap` / `make vault-seed-dev` flow).
4. Phase 7 docs updated in the same task (repo rule).
