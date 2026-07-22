# Docker Notes

Reference guide explaining Docker concepts used in this project.

---

## Images vs Containers

- An **image** is a read-only blueprint (like a class definition).
- A **container** is a running instance of an image (like an object instance).
- `docker build` creates an image; `docker run` (or `compose up`) creates a container from it.

---

## Dockerfile Concepts

### Multi-Stage Builds

Multi-stage builds use multiple `FROM` instructions in a single Dockerfile. Only artefacts explicitly copied with `COPY --from=<stage>` end up in the final image.

**Why it matters:** The `frontend` and `backend` Dockerfiles use a `builder` stage to compile the application. The final runtime image contains only the compiled output — not the compilers, package managers, or source code. This significantly reduces the image size and attack surface.

```dockerfile
# Stage 1: compile
FROM node:24-alpine AS builder
RUN npm ci && npm run build

# Stage 2: run — only the /app/dist folder is copied
FROM alpine:3.19
COPY --from=builder /app/dist /app/dist
```

### Layer Caching

Each `RUN`, `COPY`, and `ADD` instruction creates a new layer. Docker caches layers and only re-runs instructions when the layer or a preceding layer has changed.

**Best practice:** Copy dependency manifests (`package.json`, `requirements.txt`) before copying source code. This way, dependencies are only reinstalled when the manifest changes — not on every source code change.

---

## Volumes

A volume is persistent storage that lives outside the container's writable layer.

### Why volumes instead of bind mounts?

|               | Named Volume                 | Bind Mount                 |
| ------------- | ---------------------------- | -------------------------- |
| Portability   | ✅ Works on any host         | ❌ Path must exist on host |
| Performance   | ✅ Managed by Docker         | ✅ Direct host I/O         |
| Backup        | Via `docker volume` commands | Direct file system access  |
| 42 compliance | ✅ Preferred                 | ⚠️ Check project rules     |

### Named volumes in this project

```yaml
volumes:
    db_data: # PostgreSQL data directory
    redis_data: # Redis persistence files
    nginx_config: # Nginx vhost configs
    nginx_ssl: # TLS certificates
    frontend_static: # Compiled SPA assets
    logs: # All service logs
    monitoring_data: # Grafana / Prometheus data
    portainer_data: # Portainer config
```

### Useful volume commands

```bash
# List volumes
docker volume ls

# Inspect a volume (find its mount path on the host)
docker volume inspect transcendence_db_data

# Remove a specific volume
docker volume rm transcendence_db_data

# Remove all unused volumes (DANGEROUS)
docker volume prune
```

---

## Networks

Docker networks are virtual bridges that allow containers to communicate with each other using their service names as hostnames.

### Bridge networks

The default and most common network type. Each bridge network is isolated — containers on different networks cannot reach each other unless they share a network.

### Service discovery

Within a Docker Compose project, containers can reach each other by **service name**. For example, the backend container connects to `database:5432` — Docker resolves `database` to the container's internal IP automatically.

### This project's networks

| Network            | Subnet        | Members                                                 |
| ------------------ | ------------- | ------------------------------------------------------- |
| `frontend_network` | 172.20.0.0/24 | reverse_proxy, frontend, backend, monitoring, portainer |
| `backend_network`  | 172.20.1.0/24 | backend, database, redis, monitoring                    |

**The key rule:** `database` and `redis` are exclusively on `backend_network`. Even if the `frontend` container is compromised, it has no network route to the database.

---

## Healthchecks

A healthcheck is a command Docker runs periodically inside the container to determine if the service is functioning correctly.

### Healthcheck states

- `starting` — waiting for `start_period` to elapse
- `healthy` — last check passed
- `unhealthy` — last N checks failed (N = `retries`)

### Why healthchecks matter for this project

The `depends_on` directive in Compose supports `condition: service_healthy`. This means `backend` will not start until `database` passes its healthcheck. Without this, the backend might try to connect to PostgreSQL before it has finished initialising and fail.

### Healthcheck example

```yaml
healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
    interval: 10s # How often to run the check
    timeout: 5s # Maximum time for one check to complete
    retries: 5 # Failures before marking unhealthy
    start_period: 30s # Grace period after container start
```

---

## Restart Policies

| Policy           | Behaviour                                      |
| ---------------- | ---------------------------------------------- |
| `no`             | Never restart (default)                        |
| `always`         | Always restart, even after `docker stop`       |
| `unless-stopped` | Restart on failure but not if manually stopped |
| `on-failure`     | Restart only on non-zero exit code             |

This project uses `restart: unless-stopped` for all services. This means:

- Services restart automatically after a crash or host reboot.
- `make down` / `docker stop` stops them without an automatic restart.

---

## Environment Variables

Environment variables are passed to containers from:

1. The `.env` file (loaded by Compose automatically when `--env-file` is specified)
2. The `environment:` block in `docker-compose.yml`
3. Build arguments (`ARG` / `--build-arg`) for image build time

**Never commit real passwords to `.env`.** The `.env` file is listed in `.gitignore`. The `.env.example` file (committed) contains only placeholder values.
