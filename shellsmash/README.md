# Shell Smash 🐢

**A sumo-turtle gaming hub.** Players take on the role of sumo turtle
warriors, customizing their shell and competing in a growing collection
of arcade minigames set in a Japanese temple courtyard.

## Concept

The hub is a dojo courtyard. Each minigame is represented as a shrine the
player can enter. The first playable shrine is **Shell Smash Arena** — a
1v1 sumo knockout where players launch their turtle to push opponents out
of the ring. Additional shrines (Bell Clash, River Rush, Bamboo Bash, and
more) are shown as "sealed" / Coming Soon and will open up as they're
built.

Players have:
- A persistent profile (level, XP, win/loss record)
- A customizable turtle (`turtleName`, `shellSkin`)
- A spot on the Dojo Rankings leaderboard

## Stack

- **Backend:** NestJS + TypeORM + PostgreSQL, 42 OAuth + JWT auth
- **Frontend:** Phaser.js + Vite
- **Infra:** Docker Compose — Nginx reverse proxy, Redis, Postgres,
  optional monitoring/Portainer services

## Running locally

```bash
make up
```

Then visit `https://localhost`.

See `docs/` for architecture notes and `.env.example` for required
environment variables (including 42 OAuth credentials).

## Status

🚧 Early hub MVP — Shell Smash Arena gameplay is not yet implemented;
the hub currently shows the arena shrine as a placeholder and renders
the other shrines as sealed/Coming Soon.
