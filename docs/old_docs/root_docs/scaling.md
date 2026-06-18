# Scaling

Notes on horizontal scaling, load balancing, and stateless service design for ft_transcendence.

---

## Current Architecture Limitations

The current single-host Docker Compose setup is appropriate for a 42 project evaluation. The architecture is designed so that scaling can be added later without restructuring the codebase.

---

## Stateless Service Design

For a service to scale horizontally, it must be **stateless** — all state must be stored outside the container.

| Service         | Stateless? | Notes                                           |
| --------------- | ---------- | ----------------------------------------------- |
| `reverse_proxy` | ✅         | Config from volume; no per-request state        |
| `frontend`      | ✅         | Serves static files; fully stateless            |
| `backend`       | ⚠️         | **Must** store sessions in Redis, not in-memory |
| `database`      | ❌         | Stateful by design; scale via replication       |
| `redis`         | ❌         | Stateful; scale via Redis Cluster or Sentinel   |

**Design rule:** The backend must never store session data in a local variable or in-process cache. All shared state (user sessions, game rooms, rate limit counters) must live in Redis or PostgreSQL.

---

## Horizontal Scaling with Docker Compose

Scale the backend to multiple replicas:

```bash
docker compose -f srcs/docker-compose.yml up -d --scale backend=3
```

This requires:

1. Removing the `container_name` from the backend service (names must be unique).
2. Removing the `expose` port from the backend (Nginx balances across replicas).
3. Configuring Nginx `upstream` with load balancing:

```nginx
upstream backend_cluster {
    # Round-robin (default)
    server backend:8000;  # Compose resolves to all replicas

    # Or least-connections:
    # least_conn;
    # server backend:8000;
}

location /api/ {
    proxy_pass http://backend_cluster;
}
```

Docker Compose's internal DNS resolver automatically returns all replica IPs for the service name.

---

## Load Balancing Strategies

| Strategy          | Nginx directive | Best for                            |
| ----------------- | --------------- | ----------------------------------- |
| Round-robin       | (default)       | Homogeneous requests                |
| Least connections | `least_conn`    | Long-lived WebSocket connections    |
| IP hash           | `ip_hash`       | Sticky sessions (avoid if possible) |
| Weighted          | `weight=N`      | Mixed-capacity nodes                |

**Prefer stateless + round-robin** over sticky sessions. Sticky sessions couple clients to specific instances, making rolling deploys harder.

---

## WebSocket Scaling Considerations

WebSocket connections are long-lived. When multiple backend replicas exist, a client's WebSocket connection lands on one replica. If the game event is generated on a different replica, it won't reach the client.

**Solution: Redis Pub/Sub**

All backend replicas subscribe to Redis channels. When replica A generates a game event, it publishes to Redis. All other replicas (which hold other clients' WebSocket connections) receive the event and forward it to their connected clients.

```
Client A ──── WS ──── Backend-1 ──┐
Client B ──── WS ──── Backend-2 ──┼── Redis Pub/Sub channel: game:room:42
Client C ──── WS ──── Backend-1 ──┘
```

This is already supported by this infrastructure — Redis is pre-integrated for exactly this purpose.

---

## Database Scaling

PostgreSQL can be scaled with:

1. **Read replicas** (streaming replication) — offload read queries to replicas
2. **Connection pooling** (PgBouncer) — reduce connection overhead at scale
3. **Partitioning** — partition large tables (e.g., game history) by date

For a 42 project, the single primary PostgreSQL instance is more than sufficient.

---

## Production Scaling Path

```
Single host (42 evaluation)
    └─► Docker Compose, single replicas

Growing project
    └─► Docker Compose with --scale backend=N

Multi-host production
    └─► Docker Swarm or Kubernetes
        ├── Backend: Deployment with N replicas
        ├── Database: StatefulSet with primary + read replicas
        ├── Redis: Redis Cluster (3+ nodes)
        └── Nginx: DaemonSet or external load balancer
```
