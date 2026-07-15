# Repository Guidelines

## Reglas Base
- Siempre que se genera cualquier documentacion que se suba al repositorio el idioma tiene que ser sin falta ingles britanico. No se puede subir ningun archivo al repositorio que no este estrictamente en ingles britanico.
- El idioma de respuesta debe ser siempre el idioma del usuario. Si hay duda real, usa ingles.
- Si un cambio modifica reglas de trabajo, flujos o convenciones reflejadas aqui, actualiza `AGENTS.md` en la misma tarea.
- Cualquier cambio en el proyecto debe revisar `docs/modules-progress.md` para comprobar si se completo algun avance de modulo y, si aplica, actualizar ese archivo para reflejar el nuevo progreso.
- Todo documento nuevo del proyecto debe guardarse en `docs/`.
- Antes de redactar o investigar, prioriza `docs/`. El enunciado principal esta en `docs/en.subject.md` y su version PDF en `docs/en.subject.pdf`.
- `docs/deprecated/` y `docs/old_docs/` son archivo historico. No deben usarse como fuente principal para entender el proyecto ni para tomar decisiones actuales, salvo peticion explicita del usuario.
- El alcance funcional del proyecto queda acotado por `docs/modules-progress.md`. No anadas modulos o funcionalidades fuera de ese marco salvo peticion explicita del usuario.

## Indice Operativo
- Contexto general del producto: `docs/project-overview.md`
- Enunciado y alcance: `docs/en.subject.md`
- Docker y despliegue: `docker-compose.yml`, `docker-compose.override.yml`, `docs/deployment.md`, `docs/docker-notes.md`
- Arquitectura de servicios: `docs/project-overview.md`, `docs/service-map.md`
- Frontend: `frontend/src/`, `public/`
- Backend: `backend/src/`
- Comandos de trabajo: `Makefile`
- Seguridad y OAuth: `docs/security.md`, `docs/oauth-setup.md`
- Alcance y estado de modulos: `docs/modules-progress.md`
- Archivo historico: `docs/deprecated/`, `docs/old_docs/`

## Estructura Del Proyecto
`frontend/` contiene la SPA con Vite, React y Phaser. `backend/` contiene la API NestJS con TypeORM y migraciones en `backend/src/migrations/`. `infra/` agrupa Nginx, PostgreSQL, Redis, Vault, monitorizacion y configuracion auxiliar. `scripts/` contiene utilidades locales. `public/` guarda assets compartidos. `docs/` centraliza la documentacion viva del proyecto.

## Docker
La pila principal vive en `docker-compose.yml`; `docker-compose.override.yml` activa hot reload para desarrollo.

- `reverse_proxy`: entrada HTTPS unica; termina TLS y enruta frontend, API y monitorizacion.
- `frontend`: cliente Vite/React/Phaser servido internamente en el stack.
- `backend`: API NestJS, autenticacion, logica de juego y acceso a datos.
- `database`: PostgreSQL persistente para usuarios, perfiles y datos de juego.
- `redis`: cache, soporte de sesiones y base para tiempo real o colas futuras.
- `monitoring`: panel de monitorizacion expuesto detras de Nginx.
- `vault`: origen central de secretos en local.
- `backend_vault_agent`: renderiza secretos consumidos por backend.
- `database_vault_agent`: renderiza password y secretos de PostgreSQL.
- `redis_vault_agent`: renderiza password y secretos de Redis.
- `monitoring_vault_agent`: renderiza secretos del servicio de monitorizacion.

## Frontend Y Backend
Manten el mismo formato que ya existe. La base actual usa tabs de ancho `4` en [`.prettierrc.json`](/home/marcos/programming/transgender/.prettierrc.json). No mezcles estilos nuevos. En frontend respeta la organizacion por `pages/`, `routes/`, `hooks/`, `shared/` y nombres tipo `PascalCase` para componentes y `camelCase` para hooks o utilidades. En backend sigue el estilo TypeScript/NestJS actual y las reglas de ESLint ya definidas.

## Makefile
Usa siempre el `Makefile` como entrada principal del entorno local.

- Arranque: `make up`, `make dev`, `make prod`, `make down`, `make restart`, `make re`
- Servicios concretos: `make restart-front`, `make restart-back`, `make rebuild-front`, `make rebuild-back`, `make refresh-app`
- Build y estado: `make build`, `make logs SERVICE=backend`, `make ps`, `make status`, `make health`
- Diagnostico y limpieza: `make diagnosis`, `make clean`, `make fclean`
- Inspeccion: `make shell SERVICE=backend`, `make inspect SERVICE=backend`, `make volumes`, `make networks`, `make db`, `make open`
- Vault y certificados: `make vault-bootstrap`, `make vault-init`, `make vault-unseal`, `make vault-seed-dev`, `make vault-status`, `make certs`, `make prepare-local-secrets`
- Entorno y ayuda: `make check-env`, `make help`
- Flujo git automatizado: `make push M="mensaje"`

## Testing Y Validacion
Backend usa Jest con `*.spec.ts`; ejecuta `cd backend && npm run test` o `npm run test:cov`. Para cambios integrados en la plataforma, valida con `make dev` o `make up` segun el modo que toque. Si no hay tests de frontend para una zona, documenta la validacion manual en la entrega.

When a runtime error, frozen scene, or logical failure remains unexplained after static analysis, launch Firefox in headless/developer mode and autonomously reproduce the required user flows. Inspect the browser console, network activity, visual state, and available traces to identify the cause before applying a fix. This diagnostic step complements, rather than replaces, automated tests and final manual validation.

## Commits
El historial reciente usa mensajes cortos y directos, por ejemplo `Fixed auth and removed CORS restrictions`. Mantén ese nivel de concrecion: una idea por commit, sin titulos vagos.
