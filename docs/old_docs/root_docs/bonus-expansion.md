# Bonus Expansion Guide

How to add bonus services to the ft_transcendence Docker infrastructure.

---

## How to Add a New Service

1. Create `srcs/requirements/<service_name>/Dockerfile`
2. Create `srcs/requirements/<service_name>/tools/entrypoint.sh`
3. Uncomment the relevant service block in `srcs/docker-compose.yml`
4. Add required environment variables to `.env.example` and `.env`
5. Add the named volume (if needed) to the `volumes:` section of compose
6. Update `docs/service-map.md` and `docs/architecture.md`

---

## Authentication Service (42 Login Bonus)

**Purpose:** Centralised authentication with 42 Intra OAuth.

**Network:** `frontend_network` (receives requests from Nginx) + `backend_network` (reads from database)

**Volumes:** None (stateless; tokens stored in Redis)

**Implementation options:**

- Integrate 42 OAuth directly into the main backend (simplest)
- Create a dedicated `auth_service` that issues JWTs (more scalable)

**42 OAuth flow:**

```
User clicks "Login with 42"
  → Browser → /api/auth/42 → backend
  → Redirect → api.intra.42.fr/oauth/authorize
  → User approves
  → 42 → callback → /api/auth/42/callback?code=XXX
  → Backend exchanges code for token at 42 API
  → Backend creates/updates user in DB
  → Backend issues JWT → Frontend stores it
```

**Environment variables needed:**

```
FORTYTWO_CLIENT_ID=<from 42 intra app settings>
FORTYTWO_CLIENT_SECRET=<from 42 intra app settings>
FORTYTWO_CALLBACK_URL=https://<your-domain>/api/auth/42/callback
```

---

## Chat Service (WebSocket Chat Bonus)

**Purpose:** Real-time direct messages and channel-based chat.

**Network:** `frontend_network` (WebSocket upgrade via Nginx `/ws/chat/`) + `backend_network` (Redis for message delivery)

**Volumes:** Chat history stored in PostgreSQL (shared `db_data` volume or separate DB)

**Technology options:**

- Django Channels (if using Django)
- Socket.io with Redis adapter (if using Node)
- Dedicated Go chat server

**Nginx route to add:**

```nginx
location /ws/chat/ {
    proxy_pass http://chat_service:8002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## Matchmaking Service (Tournament Bonus)

**Purpose:** Queue management, ELO rating, game session creation.

**Network:** `backend_network` (called internally by the main backend API)

**Volumes:** Uses existing `db_data` (matchmaking records) and `redis_data` (queues)

**Data flow:**

```
User requests match → Backend → Matchmaking service
  → Checks Redis queue for opponent
  → If found: creates game session, notifies both players via Redis pub/sub
  → If not found: adds user to Redis queue, waits
```

---

## Elasticsearch (Search Bonus)

**Purpose:** Full-text search across user profiles, game history, chat logs.

**Network:** `backend_network` (internal only)

**Volume:** Requires a new `elasticsearch_data` volume (data can be large: plan 1–10 GB)

**Compose snippet:**

```yaml
elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
    environment:
        - discovery.type=single-node
        - ES_JAVA_OPTS=-Xms512m -Xmx512m
        - xpack.security.enabled=false # Enable in production
    volumes:
        - elasticsearch_data:/usr/share/elasticsearch/data
    networks:
        - backend_network
```

**Security note:** Enable X-Pack security (TLS + authentication) before exposing Elasticsearch beyond `localhost`.

---

## Prometheus + Grafana (Monitoring Bonus)

**Purpose:** Metrics collection and dashboards.

**Network:** Both networks (to scrape metrics from all services)

**Replace the `monitoring` service** in `docker-compose.yml` with:

```yaml
prometheus:
    image: prom/prometheus:v2.51.0
    volumes:
        - ./requirements/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
        - monitoring_data:/prometheus
    networks: [frontend_network, backend_network]

grafana:
    image: grafana/grafana:10.4.0
    environment:
        - GF_SECURITY_ADMIN_USER=${GF_ADMIN_USER}
        - GF_SECURITY_ADMIN_PASSWORD=${GF_ADMIN_PASSWORD}
    volumes:
        - grafana_data:/var/lib/grafana
    networks: [frontend_network]
```

**Metrics to instrument in the backend:**

- `http_requests_total` — request count by endpoint and status code
- `http_request_duration_seconds` — latency histogram
- `websocket_connections_active` — live WebSocket count
- `game_sessions_active` — active game rooms
- `matchmaking_queue_length` — waiting players

---

## AI Opponent Service (AI Bonus)

**Purpose:** Serve an AI player that competes in real games.

**Network:** `backend_network` (called by the game service via REST or gRPC)

**Interface:** The game service sends the current game state; the AI service returns the next move.

```json
POST /ai/move
{ "ball": { "x": 0.5, "y": 0.3, "vx": 0.1, "vy": -0.05 }, "paddle": { "y": 0.4 } }
→ { "action": "up" }
```

**Implementation options:**

- Rule-based (simple heuristic, no ML)
- Minimax with alpha-beta pruning (deterministic AI)
- Pre-trained reinforcement learning model (requires GPU in production)

---

## Blockchain Score Storage (Optional Advanced Bonus)

**Purpose:** Store tournament results on-chain for tamper-proof verification.

**Network:** `frontend_network` + `backend_network` (needs internet egress to reach an RPC endpoint)

**Technology:** Ethereum Sepolia testnet + Hardhat / ethers.js

**Security:** The wallet private key must be stored in Docker Secrets (never in `.env`).

```yaml
blockchain_service:
    build: ./requirements/blockchain_service
    secrets: [blockchain_private_key]
    networks: [frontend_network, backend_network]
```

```yaml
secrets:
    blockchain_private_key:
        file: ./srcs/secrets/blockchain_key.txt
```
