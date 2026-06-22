# Shell Smash 🐢

**A sumo-turtle gaming hub.** Players take on the role of sumo turtle
warriors, customizing their shell and competing in a growing collection
of arcade minigames set in a Japanese temple courtyard.

## Concept

The hub is a dojo courtyard. Each minigame is represented as a shrine the
player can enter. The first playable shrine is **Kame Knock** — a
billiards-like target-smashing minigame where players launch their shell to
clear every round. Additional shrines (Bell Clash, River Rush, Bamboo Bash, and
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
cp .env.example .env
make vault-init
make vault-unseal
make vault-seed-dev
make up
```

Then visit `https://localhost`.

Runtime secrets now live in local Vault bootstrap files under `secrets/vault/`
(gitignored). Put OAuth client credentials in `secrets/vault/dev-seed.env`
before rerunning `make vault-seed-dev`.

If local bootstrap fails with `Permission denied` while creating `secrets/...`,
the repository or `secrets/` directory is not writable by your user. Fix the
ownership first, for example:

```bash
sudo chown -R "$(id -un):$(id -gn)" secrets
```

## Repository layout

- `frontend/` — React + Phaser app
- `backend/` — NestJS API
- `infra/` — Docker service definitions for Nginx, Postgres, Redis, monitoring, and Portainer
- `public/` — shared static assets
- `docs/` — active project documentation
- `scripts/` — local helper scripts

## Status

🚧 Early hub MVP — Kame Knock is the first playable shrine; the hub renders
the other shrines as sealed/Coming Soon.
