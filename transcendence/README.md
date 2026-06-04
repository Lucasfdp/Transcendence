# ft_transcendence — Docker Infrastructure Starter Kit

> Production-oriented Docker Compose infrastructure for the 42 School ft_transcendence project.
> All technology choices remain open — this kit provides the scaffolding.

---

## Project Overview

This repository contains the complete Docker infrastructure for ft_transcendence. It implements:

- **TLS-terminated reverse proxy** (Nginx) — single entry point for all traffic
- **Frontend SPA** service — replace Dockerfile for your chosen framework
- **Backend API** service — replace Dockerfile for your chosen framework
- **PostgreSQL** database — persistent, internal-only
- **Redis** — sessions, caching, pub/sub, matchmaking queues
- **Monitoring** — Grafana/Prometheus placeholder
- **Portainer** — Docker management UI (development only)
- **Two isolated Docker networks** — security by design
- **Named volumes** — persistent data that survives container restarts

---

## Folder Structure

```
transcendence/
├── Makefile                    # All Docker operations via make targets
├── .env.example                # Environment variable template (copy to .env)
├── .gitignore                  # Excludes .env, secrets, volumes from git
├── README.md                   # This file
├── srcs/
│   ├── docker-compose.yml      # Defines all services, networks, and volumes
│   ├── requirements/
│   │   ├── reverse_proxy/      # Nginx with TLS termination
│   │   │   ├── Dockerfile
│   │   │   └── conf/default.conf
│   │   ├── backend/            # API server (Django / FastAPI / Express / …)
│   │   │   ├── Dockerfile
│   │   │   └── tools/entrypoint.sh
│   │   ├── frontend/           # SPA (React / Vue / Svelte / …)
│   │   │   ├── Dockerfile
│   │   │   └── tools/entrypoint.sh
│   │   ├── database/           # PostgreSQL 16
│   │   │   ├── Dockerfile
│   │   │   └── tools/entrypoint.sh
│   │   ├── redis/              # Redis 7
│   │   │   ├── Dockerfile
│   │   │   └── tools/redis.conf + entrypoint.sh
│   │   ├── monitoring/         # Grafana / Prometheus placeholder
│   │   │   ├── Dockerfile
│   │   │   └── tools/entrypoint.sh
│   │   └── portainer/          # Docker UI (dev only)
│   │       └── Dockerfile
│   ├── secrets/                # Docker Secrets files (gitignored)
│   ├── volumes/                # (gitignored — Docker manages named volumes)
│   └── networks/               # (informational — networks defined in compose)
└── docs/
    ├── architecture.md         # Container responsibilities, network topology
    ├── deployment.md           # How to start, stop, update, rollback
    ├── service-map.md          # Detailed container relationship diagram
    ├── docker-notes.md         # Docker concepts: images, volumes, networks
    ├── security.md             # TLS, non-root, secrets, network isolation
    ├── scaling.md              # Horizontal scaling and stateless design
    ├── bonus-expansion.md      # How to add bonus services
    └── service-decision-log.md # Team technology choices and rationale
```

---

## Service Descriptions

| Service | Image | Purpose |
|---------|-------|---------|
| `reverse_proxy` | Custom Nginx Alpine | TLS termination, request routing |
| `frontend` | Custom Node Alpine | SPA framework (replace Dockerfile) |
| `backend` | Custom Alpine | REST API + WebSockets (replace Dockerfile) |
| `database` | Custom Postgres Alpine | Persistent relational data |
| `redis` | Custom Redis Alpine | Cache, sessions, pub/sub, queues |
| `monitoring` | Custom Alpine | Metrics + log dashboards |
| `portainer` | Portainer CE Alpine | Docker management UI (dev only) |

---

## Startup Instructions

### Prerequisites

- Docker Engine 24+
- Docker Compose v2 (`docker compose` not `docker-compose`)
- `make`

### First run

```bash
# 1. Copy and configure the environment file
cp .env.example .env
# Edit .env — set all passwords and secrets before continuing

# 2. Start all services
make up

# 3. Check everything is running
make ps

# 4. Open in browser
open https://localhost
```

> **Note:** Your browser will warn about the self-signed certificate. Accept the exception for local development.

---

## Shutdown Instructions

```bash
# Stop containers (preserves all data in named volumes)
make down

# Stop AND delete all data (database, redis, logs)
make fclean
```

---

## Development Workflow

```bash
make up          # Start all services
make logs        # Watch all logs (Ctrl+C to exit)
make ps          # Check service health status
make restart     # Restart all services
make build       # Rebuild images without cache

# Open a shell in a running container
make shell SERVICE=backend
make shell SERVICE=database

# Inspect a specific container
make inspect SERVICE=backend

# List project volumes
make volumes

# List project networks
make networks
```

---

## Deployment Workflow

1. Edit application code in `srcs/requirements/<service>/`
2. Run `make build` to rebuild images
3. Run `make restart` to apply changes
4. Run `make ps` to verify all services are healthy
5. Run `make logs` to check for errors

---

## Troubleshooting

### Services are unhealthy after `make up`

```bash
# Check logs for a specific service
docker compose -f srcs/docker-compose.yml logs database
docker compose -f srcs/docker-compose.yml logs backend
```

### `.env` file is missing

```bash
cp .env.example .env
# Edit .env and set real values, then run make up again
```

### Port 443 is already in use

```bash
sudo lsof -i :443   # Find the process using port 443
# Or change HTTPS_PORT in .env to another port (e.g. 8443)
```

### Database volume has stale data

```bash
make fclean   # Destroys all volumes — DELETES ALL DATA
make up       # Fresh start
```

### Nginx returns 502 Bad Gateway

The backend or frontend service is not yet healthy. Wait 30–60 seconds and retry. Check with:

```bash
make ps
```

### Container exits immediately

```bash
docker compose -f srcs/docker-compose.yml logs <service>
```

Look for error messages in the log output. Common causes:
- Missing environment variable
- Port already in use
- Dependency service not yet healthy

---

## Future Expansion Strategy

This infrastructure is designed to grow. To add a new service:

1. Create `srcs/requirements/<new_service>/Dockerfile`
2. Create `srcs/requirements/<new_service>/tools/entrypoint.sh`
3. Uncomment the placeholder block in `srcs/docker-compose.yml`
4. Add required variables to `.env.example`
5. Update documentation

See `docs/bonus-expansion.md` for detailed guides for each planned bonus service.

---

## Evaluation Preparation Notes

Things to be ready to explain during 42 peer evaluation:

- **Why Nginx and not Apache?** Nginx is event-driven (better for concurrent connections and WebSocket proxying).
- **Why two Docker networks?** Network isolation prevents the frontend from directly accessing the database even if a container is compromised.
- **Why named volumes instead of bind mounts?** Portability — the project works on any machine without requiring a specific host directory structure.
- **Why non-root users?** If a container vulnerability allows code execution, root access inside a container could be leveraged for host escape in some configurations.
- **Why `restart: unless-stopped`?** Services recover automatically from crashes but stop cleanly on `docker compose down`.
- **Why is Portainer here?** Development convenience only. The project must work without it.
- **What does `make fclean` do?** Removes all containers, images, AND volumes (destroys all data). Used for a completely fresh start.

---

*This starter kit contains infrastructure only. No application code is included. All technology choices for the backend, frontend, and WebSocket layer remain open.*
