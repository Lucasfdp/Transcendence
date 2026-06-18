# Service Map

## Container Relationship Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL                                                                │
│  Browser / Client                                                        │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ HTTPS :443  /  HTTP :80 (redirect)
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  reverse_proxy  (Nginx)                                                  │
│  ─────────────────────                                                   │
│  • Terminates TLS (TLS 1.2 / 1.3 only)                                  │
│  • Sets security headers (HSTS, X-Frame-Options, CSP …)                 │
│  • Routes /        → frontend                                            │
│  • Routes /api/    → backend                                             │
│  • Routes /ws/     → backend (WebSocket upgrade)                        │
│  • Serves /var/www/html static files directly                           │
└────────────┬─────────────────────────┬───────────────────────────────────┘
             │ frontend_network        │ frontend_network
             ▼                         ▼
┌────────────────────────┐   ┌─────────────────────────────────────────────┐
│  frontend              │   │  backend  (API + WebSocket)                 │
│  ──────────────────    │   │  ─────────────────────────                  │
│  • SPA (React/Vue/…)   │   │  • REST API endpoints                       │
│  • Client-side routing │   │  • WebSocket game server                    │
│  • Communicates with   │   │  • Authentication / JWT                     │
│    backend only via    │   │  • Business logic layer                     │
│    Nginx (/api/, /ws/) │   │  • ORM / query layer                        │
└────────────────────────┘   └──────────────────┬──────────────────────────┘
                                                │ backend_network
                        ┌───────────────────────┴──────────────────────────┐
                        │                                                   │
                        ▼                                                   ▼
          ┌─────────────────────────┐               ┌──────────────────────┐
          │  database  (PostgreSQL) │               │  redis               │
          │  ───────────────────── │               │  ─────────────────── │
          │  • Persistent tables   │               │  • Session tokens     │
          │  • User accounts       │               │  • Pub/Sub channels   │
          │  • Game history        │               │  • Request rate cache │
          │  • Tournament brackets │               │  • Matchmaking queues │
          │  • Friendships         │               │  • Live game state    │
          │  ONLY backend_network  │               │  ONLY backend_network │
          └─────────────────────────┘               └──────────────────────┘

         ┌────────────────────────────────────────────────────────────────┐
         │  monitoring  (frontend + backend network)                      │
         │  ─────────────────────────────────────                        │
         │  • Scrapes /metrics from all services                          │
         │  • Grafana dashboards (latency, errors, throughput)            │
         │  • Log aggregation via Loki                                    │
         └────────────────────────────────────────────────────────────────┘

         ┌────────────────────────────────────────────────────────────────┐
         │  portainer  (frontend network, dev only)                       │
         │  ─────────────────────────────────────                        │
         │  • Docker management UI                                        │
         │  • Inspect containers, volumes, networks                       │
         │  • DISABLE before evaluation / production                      │
         └────────────────────────────────────────────────────────────────┘
```

---

## Network Membership Summary

| Service       | frontend_network | backend_network | Host port |
| ------------- | :--------------: | :-------------: | :-------: |
| reverse_proxy |        ✅        |        —        |  80, 443  |
| frontend      |        ✅        |        —        |     —     |
| backend       |        ✅        |       ✅        |     —     |
| database      |        —         |       ✅        |     —     |
| redis         |        —         |       ✅        |     —     |
| monitoring    |        ✅        |       ✅        |     —     |
| portainer     |        ✅        |        —        |   9443    |

---

## Dependency Graph

```
reverse_proxy
    ├── DEPENDS ON: frontend (healthy)
    └── DEPENDS ON: backend  (healthy)

backend
    ├── DEPENDS ON: database (healthy)
    └── DEPENDS ON: redis    (healthy)

frontend      → no service dependencies
database      → no service dependencies
redis         → no service dependencies
monitoring    → no service dependencies
portainer     → no service dependencies
```

---

## Port Reference

| Service       | Internal port | External port           | Protocol     |
| ------------- | ------------- | ----------------------- | ------------ |
| reverse_proxy | 80 / 443      | 80 / 443                | HTTP / HTTPS |
| frontend      | 3000          | — (via Nginx)           | HTTP         |
| backend       | 8000          | — (via Nginx)           | HTTP / WS    |
| database      | 5432          | — (internal only)       | TCP          |
| redis         | 6379          | — (internal only)       | TCP          |
| monitoring    | 3000          | — (via Nginx or direct) | HTTP         |
| portainer     | 9443          | 9443                    | HTTPS        |
