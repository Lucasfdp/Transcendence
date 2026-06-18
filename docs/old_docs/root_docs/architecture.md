# Architecture

## Overview

ft_transcendence uses a containerised microservice architecture where each concern is isolated in its own Docker container. All containers are orchestrated with Docker Compose and communicate exclusively through Docker virtual networks.

---

## Container Responsibilities

| Container       | Role                             | Technology                      |
| --------------- | -------------------------------- | ------------------------------- |
| `reverse_proxy` | TLS termination, request routing | Nginx                           |
| `frontend`      | Single-page application          | React / Vue / Svelte (TBD)      |
| `backend`       | REST API + WebSocket server      | Django / FastAPI / NestJS (TBD) |
| `database`      | Relational data persistence      | PostgreSQL 16                   |
| `redis`         | Caching, queues, pub/sub         | Redis 7                         |
| `monitoring`    | Metrics + log dashboards         | Grafana / Prometheus (TBD)      |
| `portainer`     | Docker management UI (dev only)  | Portainer CE                    |

---

## Network Topology

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Host machine                                   │
│                                                 │
│  :80  ──────────────► reverse_proxy             │
│  :443 ──────────────► reverse_proxy             │
│                              │                  │
│          frontend_network (172.20.0.0/24)        │
│          ┌───────────────────┘                  │
│          │                                      │
│          ├──► frontend   (:3000)                │
│          ├──► backend    (:8000)  ───────────┐  │
│          ├──► monitoring (:3000)             │  │
│          └──► portainer  (:9443)             │  │
│                                              │  │
│          backend_network (172.20.1.0/24)     │  │
│          ┌───────────────────────────────────┘  │
│          │                                      │
│          ├──► database   (:5432)                │
│          ├──► redis      (:6379)                │
│          └──► monitoring (:3000)                │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Key isolation rule:** The database and Redis are only reachable from `backend_network`. The frontend and reverse proxy cannot initiate connections to them directly.

---

## Communication Flow

### User Request — REST API

```
Browser → HTTPS :443 → Nginx
       → proxy_pass /api/ → backend:8000
       → PostgreSQL :5432 (query)
       → Redis :6379 (cache lookup)
       ← response
       ← Nginx ← Browser
```

### User Request — WebSocket (Game / Chat)

```
Browser → HTTPS :443 → Nginx (Upgrade: websocket)
       → proxy_pass /ws/ → backend:8000
       → Redis pub/sub (broadcast to other clients)
       ← frames ← Nginx ← Browser
```

### Static Assets

```
Browser → HTTPS :443 → Nginx
       → proxy_pass / → frontend:3000
       ← HTML / JS / CSS / assets
```

---

## Data Flow

```
User action (browser)
  └─► Nginx (TLS, rate limit, routing)
        └─► Backend API (business logic, auth)
              ├─► PostgreSQL (persist state)
              ├─► Redis (cache, queue, pub/sub)
              └─► Response → Nginx → Browser
```

---

## Volume Map

| Volume            | Container mount                                 | Purpose                       |
| ----------------- | ----------------------------------------------- | ----------------------------- |
| `db_data`         | `/var/lib/postgresql/data`                      | PostgreSQL tables and indexes |
| `redis_data`      | `/data`                                         | Redis RDB / AOF files         |
| `nginx_config`    | `/etc/nginx/conf.d`                             | Nginx vhost configs           |
| `nginx_ssl`       | `/etc/nginx/ssl`                                | TLS certificates              |
| `frontend_static` | `/app/dist` (frontend), `/var/www/html` (nginx) | Compiled SPA files            |
| `logs`            | `/var/log/*`                                    | Centralised log storage       |
| `monitoring_data` | `/var/lib/monitoring`                           | Metrics time-series data      |
| `portainer_data`  | `/data`                                         | Portainer credentials         |
