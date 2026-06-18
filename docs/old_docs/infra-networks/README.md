# srcs/networks/

This directory is informational. Docker networks for this project are defined in `srcs/docker-compose.yml` and created automatically by Docker Compose.

## Networks defined in this project

### frontend_network (172.20.0.0/24)

Members: `reverse_proxy`, `frontend`, `backend`, `monitoring`, `portainer`

Purpose: Carries traffic that originates from or is destined for the browser. The reverse proxy is the only container with external host ports.

### backend_network (172.20.1.0/24)

Members: `backend`, `database`, `redis`, `monitoring`

Purpose: Internal service communication. The database and Redis are only reachable from this network. The frontend and reverse proxy have no route to them.

## Useful commands

```bash
# List all networks for this project
make networks

# Inspect a network
docker network inspect transcendence_frontend_network

# Verify which containers are connected to a network
docker network inspect transcendence_backend_network --format '{{range .Containers}}{{.Name}} {{end}}'
```
