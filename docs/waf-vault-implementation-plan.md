# Plan: ModSecurity WAF + HashiCorp Vault en Shell Smash

## Summary

- Convertir `reverse_proxy` en un Nginx con ModSecurity y OWASP CRS, en modo estricto para el stack principal.
- Añadir un servicio `vault` dentro del mismo `docker-compose`, aislado en la red interna, para centralizar todos los secretos sensibles.
- Sacar los secretos reales de `.env` y hacer que `backend`, `database`, `redis` y `monitoring` los lean desde archivos renderizados por Vault.

## Key Changes

### WAF / reverse proxy

- Rehacer la imagen de `reverse_proxy` para cargar `libmodsecurity` + conector Nginx + OWASP CRS desde un Dockerfile del repo.
- Activar ModSecurity en `location /api/` y `/admin/`; dejar `location /ws/` fuera del WAF para no romper upgrades; no inspeccionar `location /` del SPA.
- Configuración base cerrada: `SecRuleEngine On`, CRS paranoia level 2, inspección JSON, límite de body alineado con los 10 MB actuales, audit log persistente en `logs`.
- Añadir exclusiones explícitas para `GET /api/auth/42/callback` y `GET /api/auth/github/callback` para no romper OAuth durante el bloqueo estricto.

### Vault / secretos

- Añadir servicio `vault` con almacenamiento `raft` en volumen dedicado, sin puerto público por defecto y solo en `backend_network`.
- Añadir flujo operativo decidido: `make vault-init`, `make vault-unseal`, `make vault-seed-dev`, `make vault-status`.
- Guardar únicamente bootstrap material local en rutas ignoradas tipo `srcs/secrets/vault/` para claves de unseal, root token y credenciales AppRole.
- Crear KV v2 por servicio: `kv/transcendence/dev/backend`, `kv/transcendence/dev/database`, `kv/transcendence/dev/redis`, `kv/transcendence/dev/monitoring`.
- Crear una policy por servicio y autenticar contenedores con AppRole.

### Entrega de secretos a runtime

- Añadir un Vault Agent compañero por servicio sensible para renderizar archivos de secretos en volúmenes compartidos.
- Cambiar entrypoints para esperar esos archivos antes de arrancar el proceso real.
- `backend` deja de depender de secretos reales en `environment:` y pasa a cargar `JWT_SECRET`, `SECRET_KEY`, OAuth secrets, DB/Redis creds y `METRICS_TOKEN` desde fichero renderizado.
- `database` y `redis` pasan a leer contraseña desde archivo renderizado; `monitoring` hace lo mismo con credenciales sensibles.
- `.env.example` queda solo con configuración no sensible y refs públicas; `VITE_API_URL` y `VITE_GITHUB_AUTH_URL` siguen fuera de Vault.

## Public / Operational Interfaces

- Nuevos servicios de Compose: `vault` y sidecars/companions de Vault Agent para `backend`, `database`, `redis` y `monitoring`.
- Nuevos comandos operativos:
    - `make vault-init`
    - `make vault-unseal`
    - `make vault-seed-dev`
    - `make vault-rotate SERVICE=...`
- Nuevo comportamiento externo:
    - peticiones maliciosas a `/api/*` pueden responder `403/406` en Nginx antes de llegar a NestJS
    - si Vault está sealed o faltan secretos renderizados, los servicios dependientes no arrancan sanos

## Test Plan

### WAF

- login local, guest login, 42 OAuth, GitHub OAuth y `/ws/` siguen funcionando
- payloads obvios de SQLi, XSS y path traversal a `/api/*` quedan bloqueados y auditados
- navegación del SPA y assets siguen cargando sin falsos positivos

### Vault

- tras `vault-init` + `vault-unseal`, `backend`, `database`, `redis` y `monitoring` arrancan con secretos leídos desde Vault
- `docker compose config` y los logs no exponen secretos reales, salvo variables públicas del frontend
- rotar un secreto en Vault y reiniciar solo el servicio afectado funciona

### Fallos

- Vault sealed impide healthchecks correctos
- ausencia de fichero renderizado o AppRole inválido produce fallo explícito, no fallback inseguro

## Assumptions

- El objetivo es el stack actual de 42 en un único host con Docker Compose, no un Vault externo.
- “Hardened” se implementa como CRS en modo bloqueo en el stack principal y `DetectionOnly` solo en override de desarrollo para ajuste.
- Vault cubre secretos runtime sensibles; variables públicas de build del frontend no entran en Vault.
