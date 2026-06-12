# Deployment

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- `make` (standard on Linux/macOS)
- `openssl` (for local certificate generation)
- Git

---

## First-Time Setup

```bash
# 1. Clone the repository
git clone <repo-url> transcendence
cd transcendence

# 2. Create your .env file from the template
cp .env.example .env

# 3. Edit .env — set passwords, domain name, and secrets
#    Minimum required changes:
#      POSTGRES_PASSWORD=<strong password>
#      REDIS_PASSWORD=<strong password>
#      SECRET_KEY=<openssl rand -hex 32>
#      JWT_SECRET=<openssl rand -hex 32>
nano .env

# 4. Build images and start all services
make up

# 5. Verify all services are healthy
make ps
```

---

## Startup Procedure

`make up` performs the following steps in order:

1. Reads `.env` and validates it exists.
2. Builds Docker images for all services (uses build cache when possible).
3. Creates Docker networks (`frontend_network`, `backend_network`).
4. Creates named volumes if they do not exist.
5. Starts `database` and `redis` (no dependencies).
6. Waits for `database` and `redis` healthchecks to pass.
7. Starts `backend` (depends on database + redis being healthy).
8. Waits for `backend` healthcheck to pass.
9. Starts `frontend` (no service dependencies).
10. Waits for `frontend` healthcheck to pass.
11. Starts `reverse_proxy` (depends on frontend + backend being healthy).
12. Starts `monitoring` and `portainer`.

The application is accessible at `https://localhost` (or your configured `DOMAIN_NAME`) once `reverse_proxy` is healthy.

---

## Deployment Workflow

### Local / Development

```bash
make up        # Start all services
make logs      # Watch all logs
make ps        # Check service status
make down      # Stop (preserves volumes)
make restart   # Stop then start
```

### Rebuild After Code Changes

```bash
make build     # Rebuild all images (no cache)
make restart   # Apply new images
```

### Full Reset (destroys all data)

```bash
make fclean    # Remove containers, images, and volumes
make up        # Fresh start
```

---

## Rollback Strategy

Because all application state lives in named volumes (not in the container image), rolling back an image is non-destructive.

```bash
# 1. Note the current image tag (or git commit)
docker images | grep transcendence

# 2. Stop the affected service
docker compose -f srcs/docker-compose.yml stop backend

# 3. Check out the previous version
git checkout <previous-commit>

# 4. Rebuild only the affected service
docker compose -f srcs/docker-compose.yml build backend

# 5. Start it again
docker compose -f srcs/docker-compose.yml up -d backend
```

For database rollbacks, restore from a `pg_dump` backup:

```bash
docker compose -f srcs/docker-compose.yml exec -T database \
    psql -U $POSTGRES_USER $POSTGRES_DB < backup.sql
```

---

## Environment-Specific Notes

| Setting | Development | Production |
|---------|-------------|------------|
| `BACKEND_ENV` | `development` | `production` |
| `FRONTEND_ENV` | `development` | `production` |
| SSL | Self-signed (auto-generated) | Let's Encrypt or CA-issued |
| Portainer | Enabled | Disabled |
| Debug logging | `LOG_LEVEL=debug` | `LOG_LEVEL=warning` |
| Hot reload | Yes (dev server) | No (compiled static) |

---

## 42 Evaluation Checklist

- [ ] `make up` starts all required services cleanly
- [ ] `make down` stops all services without errors
- [ ] `make re` does a full rebuild and restart
- [ ] `https://localhost` is accessible in a browser
- [ ] The game is fully playable through the browser
- [ ] All required bonus features are accessible
- [ ] Portainer is disabled or documented as dev-only
- [ ] No secrets are committed to the repository (`.env` in `.gitignore`)
- [ ] All Dockerfiles use only Alpine-based or project-built images
