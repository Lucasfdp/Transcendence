# Service Decision Log

Record technology decisions here as the team makes them. This document helps during 42 peer evaluation — you should be able to explain every choice.

---

## Template

Copy this block for each decision:

```
### [Service Name]

**Decision date:** YYYY-MM-DD
**Decision maker(s):** Team member names

**Selected technology:** e.g. Django 4.2

**Alternatives considered:**
- FastAPI — reason not chosen
- Express.js — reason not chosen
- NestJS — reason not chosen

**Reasons for selection:**
- Reason 1
- Reason 2

**Trade-offs accepted:**
- What you gain vs. what you give up

**Implementation notes:**
- Specific configuration choices
- Libraries or plugins used
- Known limitations
```

---

## Infrastructure Decisions (Pre-filled)

### Container Runtime

**Decision date:** Project start
**Selected technology:** Docker + Docker Compose v2

**Reasons:**

- Required by 42 ft_transcendence subject
- Industry standard for containerised development
- Docker Compose makes multi-service orchestration straightforward

**Trade-offs accepted:**

- Compose is single-host only; Kubernetes would be needed for true multi-node production

---

### Reverse Proxy

**Decision date:** Project start
**Selected technology:** Nginx (Alpine)

**Alternatives considered:**

- Caddy — auto-manages Let's Encrypt; less widely known in team

**Reasons:**

- Industry standard; well-documented
- Required by 42 subject (TLS termination)
- Alpine image is small (~10 MB)
- Fine-grained WebSocket proxying control

**Trade-offs accepted:**

- Manual certificate management vs. Caddy's automatic renewal

---

### Database

**Decision date:** Project start
**Selected technology:** PostgreSQL 16 (Alpine)

**Alternatives considered:**

- MySQL / MariaDB — similar capability; PostgreSQL has better JSON support and extensibility

**Reasons:**

- Required by 42 ft_transcendence subject
- Best-in-class open-source relational database
- Django and most Python ORMs have excellent PostgreSQL support

---

### Cache / Pub-Sub

**Decision date:** Project start
**Selected technology:** Redis 7 (Alpine)

**Alternatives considered:**

- Memcached — cache only, no pub/sub; cannot be used for WebSocket broadcasting

**Reasons:**

- Required by 42 ft_transcendence subject (implied by WebSocket real-time features)
- Supports multiple use cases: sessions, caching, pub/sub, queues

---

## Application Decisions (To Be Filled)

### Backend Framework

**Decision date:** ****\_\_\_****
**Decision maker(s):** ****\_\_\_****

**Selected technology:** ****\_\_\_****

**Alternatives considered:**

- Django REST Framework
- FastAPI
- Express.js / Node
- NestJS
- Spring Boot
- Go (net/http / Gin)

## **Reasons for selection:**

## **Trade-offs accepted:**

## **Implementation notes:**

---

### Frontend Framework

**Decision date:** ****\_\_\_****
**Decision maker(s):** ****\_\_\_****

**Selected technology:** ****\_\_\_****

**Alternatives considered:**

- React (Vite)
- Vue 3 (Vite)
- Angular
- Svelte
- Vanilla TypeScript

## **Reasons for selection:**

## **Trade-offs accepted:**

## **Implementation notes:**

---

### WebSocket Strategy

**Decision date:** ****\_\_\_****
**Decision maker(s):** ****\_\_\_****

**Selected technology:** ****\_\_\_****

**Alternatives considered:**

- Django Channels (Python)
- Socket.io (Node)
- ws library (Node)
- Go gorilla/websocket
- Server-Sent Events (one-way only; not suitable for game)

## **Reasons for selection:**

---

### Authentication

**Decision date:** ****\_\_\_****
**Decision maker(s):** ****\_\_\_****

**Selected technology:** ****\_\_\_****

**Alternatives considered:**

- JWT (access + refresh tokens stored in Redis)
- Session cookies (stored in Redis)
- 42 OAuth (bonus)
- Google OAuth (bonus)

## **Reasons for selection:**

---

### ORM / Database Layer

**Decision date:** ****\_\_\_****
**Decision maker(s):** ****\_\_\_****

**Selected technology:** ****\_\_\_****

**Alternatives considered:**

- Django ORM (built-in with Django)
- SQLAlchemy / Alembic (Python)
- Prisma (Node / TypeScript)
- TypeORM (Node / TypeScript)
- Raw SQL with asyncpg

## **Reasons for selection:**
