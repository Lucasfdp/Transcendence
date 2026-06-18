# Plan de reestructuracion del proyecto Shell Smash

## Objetivo

Reordenar el repositorio sin cambiar comportamiento de la aplicacion. El refactor debe mover archivos y carpetas a una estructura mantenible, hacer que los archivos de orquestacion vivan en la raiz correcta, separar frontend y backend con convenciones reconocibles, centralizar assets compartidos en `public/` y consolidar toda la documentacion en el `docs/` moderno.

Este plan no propone reescribir logica. Los cambios de codigo solo deberian ser ajustes mecanicos de rutas, imports, Docker contexts, volumenes, scripts y referencias en documentacion.

## Diagnostico actual

La raiz del repositorio contiene archivos que compiten con los de `shellsmash/`:

- `Makefile` existe en la raiz y tambien en `shellsmash/`.
- `docs/` en la raiz parece documentacion antigua o duplicada.
- `concept_art/` esta fuera del arbol de aplicacion.
- El codigo real vive dentro de `shellsmash/srcs/requirements/...`, una estructura heredada de 42/Inception que ya no refleja bien una app React + NestJS.
- `docker-compose.yml` esta en `shellsmash/srcs/`, aunque deberia estar en la raiz funcional del proyecto.
- Frontend tiene `package.json`, `vite.config.js`, `index.html`, `src/`, `dist/` y `node_modules/` mezclados dentro de `shellsmash/srcs/requirements/frontend/src/`.
- Backend tiene una ruta redundante: `shellsmash/srcs/requirements/backend/src/src/...`.
- Assets compartidos estan repartidos entre `concept_art/` y `shellsmash/assets/`.
- La documentacion moderna esta en `shellsmash/docs/`; la documentacion de la raiz debe archivarse dentro de ella como historico.

## Decision de raiz

Hay dos opciones viables. Recomiendo la opcion A.

### Opcion A recomendada: promover `shellsmash/` a raiz real del proyecto

Mover el contenido util de `shellsmash/` a la raiz del repositorio y eliminar la carpeta envoltorio `shellsmash/`.

Ventajas:

- `Makefile`, `docker-compose.yml`, `.env.example`, `README.md`, `docs/`, `public/`, `frontend/` y `backend/` quedan donde cualquier desarrollador los espera.
- Se elimina la duplicidad entre raiz y `shellsmash/`.
- Las rutas de Docker y de los scripts se simplifican.

### Opcion B temporal: mantener `shellsmash/` como raiz funcional

Ordenar todo dentro de `shellsmash/` y dejar la raiz del repo solo como envoltorio.

Ventajas:

- Menor cambio inicial.
- Menos riesgo si hay evaluadores o scripts externos que esperan `shellsmash/`.

Desventajas:

- Sigue existiendo una raiz falsa.
- Los archivos importantes no quedan en la raiz del repo.
- Es mas facil volver a duplicar docs, Makefiles o assets.

## Estructura objetivo recomendada

```text
.
├── .env.example
├── .gitignore
├── .sonarcloud.properties
├── Makefile
├── README.md
├── docker-compose.yml
├── docker-compose.override.yml
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── security.md
│   ├── service-map.md
│   ├── service-decision-log.md
│   ├── oauth-setup.md
│   ├── project-overview.md
│   ├── restructure-plan.md
│   └── old_docs/
│       ├── root_docs/
│       ├── transcendence_max/
│       └── transcendence_meeting_prep/
├── public/
│   ├── assets/
│   │   ├── concept-art/
│   │   └── textures/
│   │       └── arenas/
│   └── favicon/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── index.html
│   ├── vite.config.js
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── features/
│   │   ├── games/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── pages/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── shared/
│   │   ├── styles/
│   │   ├── main.tsx
│   │   └── vite-env.d.ts
│   └── tools/
│       └── entrypoint.sh
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── jest.config.ts
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   │   ├── config/
│   │   ├── common/
│   │   ├── database/
│   │   ├── migrations/
│   │   └── modules/
│   │       ├── achievements/
│   │       ├── auth/
│   │       ├── customization/
│   │       ├── friends/
│   │       ├── game-results/
│   │       ├── health/
│   │       ├── matchmaking/
│   │       ├── metrics/
│   │       ├── minigames/
│   │       ├── presence/
│   │       ├── profiles/
│   │       ├── shells/
│   │       └── users/
│   └── tools/
│       └── entrypoint.sh
├── infra/
│   ├── database/
│   ├── monitoring/
│   ├── portainer/
│   ├── redis/
│   └── reverse-proxy/
├── scripts/
│   └── generate-local-certs.sh
└── secrets/
    └── nginx_ssl/
```

## Mapa de movimientos

### Raiz del proyecto

| Actual | Destino |
| --- | --- |
| `shellsmash/Makefile` | `Makefile` |
| `shellsmash/srcs/docker-compose.yml` | `docker-compose.yml` |
| `shellsmash/srcs/docker-compose.override.yml` | `docker-compose.override.yml` |
| `shellsmash/.env.example` | `.env.example` |
| `shellsmash/.gitignore` | `.gitignore` |
| `shellsmash/.sonarcloud.properties` | `.sonarcloud.properties` |
| `shellsmash/README.md` | `README.md` |
| `shellsmash/scripts/` | `scripts/` |
| `shellsmash/srcs/secrets/` | `secrets/` |

El `Makefile` de la raiz actual debe compararse con `shellsmash/Makefile`. Si no contiene nada imprescindible, se reemplaza por el de `shellsmash/`.

### Documentacion

| Actual | Destino |
| --- | --- |
| `shellsmash/docs/*` | `docs/*` |
| `docs/*.md` | `docs/old_docs/root_docs/` |
| `docs/*.docx` | `docs/old_docs/root_docs/` |
| `docs/transcendence_max/` | `docs/old_docs/transcendence_max/` |
| `docs/transcendence_meeting_prep/` | `docs/old_docs/transcendence_meeting_prep/` |

Despues del movimiento, `docs/` debe ser la unica carpeta de documentacion activa. Los documentos historicos no se borran: se archivan bajo `docs/old_docs/`.

### Assets publicos y compartidos

| Actual | Destino |
| --- | --- |
| `concept_art/*.png` | `public/assets/concept-art/` |
| `shellsmash/assets/textures/arenas/arena01.png` | `public/assets/textures/arenas/arena01.png` |
| Assets usados solo por React | `frontend/src/assets/` |
| Assets servidos estaticamente o compartidos | `public/assets/` |

Regla: si un recurso se importa desde TypeScript y forma parte del bundle, va en `frontend/src/assets/`. Si debe servirse por URL estable, compartirse con Nginx, docs o varios servicios, va en `public/`.

### Frontend

| Actual | Destino |
| --- | --- |
| `shellsmash/srcs/requirements/frontend/Dockerfile` | `frontend/Dockerfile` |
| `shellsmash/srcs/requirements/frontend/tools/` | `frontend/tools/` |
| `shellsmash/srcs/requirements/frontend/src/package.json` | `frontend/package.json` |
| `shellsmash/srcs/requirements/frontend/src/package-lock.json` | `frontend/package-lock.json` |
| `shellsmash/srcs/requirements/frontend/src/index.html` | `frontend/index.html` |
| `shellsmash/srcs/requirements/frontend/src/vite.config.js` | `frontend/vite.config.js` |
| `shellsmash/srcs/requirements/frontend/src/tsconfig.json` | `frontend/tsconfig.json` |
| `shellsmash/srcs/requirements/frontend/src/main.tsx` | `frontend/src/main.tsx` |
| `shellsmash/srcs/requirements/frontend/src/app/` | `frontend/src/app/` |
| `shellsmash/srcs/requirements/frontend/src/components/` | `frontend/src/components/` |
| `shellsmash/srcs/requirements/frontend/src/games/` | `frontend/src/games/` |
| `shellsmash/srcs/requirements/frontend/src/hooks/` | `frontend/src/hooks/` |
| `shellsmash/srcs/requirements/frontend/src/hub/` | `frontend/src/features/hub/` |
| `shellsmash/srcs/requirements/frontend/src/network/` | `frontend/src/services/network/` |
| `shellsmash/srcs/requirements/frontend/src/routes/` | `frontend/src/routes/` |
| `shellsmash/srcs/requirements/frontend/src/shared/` | `frontend/src/shared/` |
| `shellsmash/srcs/requirements/frontend/src/styles.css` | `frontend/src/styles/global.css` |

No mover:

- `node_modules/`
- `dist/`

Esas carpetas deben borrarse del control de versiones si estuvieran trackeadas y regenerarse localmente con `npm install` y `npm run build`.

Estructura React recomendada:

```text
frontend/src/
├── app/
│   └── App.tsx
├── assets/
├── components/
│   ├── auth/
│   ├── common/
│   └── layout/
├── features/
│   └── hub/
├── games/
│   ├── bamboo-bash/
│   ├── bell-clash/
│   ├── kame-knock/
│   └── shell-curl/
├── hooks/
├── lib/
├── pages/
├── routes/
├── services/
│   └── network/
├── shared/
├── styles/
├── main.tsx
└── vite-env.d.ts
```

### Backend

| Actual | Destino |
| --- | --- |
| `shellsmash/srcs/requirements/backend/Dockerfile` | `backend/Dockerfile` |
| `shellsmash/srcs/requirements/backend/tools/` | `backend/tools/` |
| `shellsmash/srcs/requirements/backend/src/package.json` | `backend/package.json` |
| `shellsmash/srcs/requirements/backend/src/package-lock.json` | `backend/package-lock.json` |
| `shellsmash/srcs/requirements/backend/src/nest-cli.json` | `backend/nest-cli.json` |
| `shellsmash/srcs/requirements/backend/src/tsconfig.json` | `backend/tsconfig.json` |
| `shellsmash/srcs/requirements/backend/src/tsconfig.build.json` | `backend/tsconfig.build.json` |
| `shellsmash/srcs/requirements/backend/src/jest.config.ts` | `backend/jest.config.ts` |
| `shellsmash/srcs/requirements/backend/src/src/main.ts` | `backend/src/main.ts` |
| `shellsmash/srcs/requirements/backend/src/src/app.module.ts` | `backend/src/app.module.ts` |
| `shellsmash/srcs/requirements/backend/src/src/app.controller.ts` | `backend/src/app.controller.ts` |
| `shellsmash/srcs/requirements/backend/src/src/migrations/` | `backend/src/migrations/` |
| `shellsmash/srcs/requirements/backend/src/src/*` | `backend/src/modules/*` cuando sean modulos de dominio |

Estructura NestJS recomendada:

```text
backend/src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── config/
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── database/
├── migrations/
└── modules/
    ├── achievements/
    ├── auth/
    ├── customization/
    ├── friends/
    ├── game-results/
    ├── health/
    ├── matchmaking/
    ├── metrics/
    ├── minigames/
    ├── presence/
    ├── profiles/
    ├── shells/
    └── users/
```

Regla: cada dominio debe conservar juntos `module`, `controller`, `service`, `dto`, `entities` y tests. Lo transversal, como guards compartidos, filtros, pipes o interceptores generales, puede ir a `common/`.

### Infraestructura

| Actual | Destino |
| --- | --- |
| `shellsmash/srcs/requirements/database/` | `infra/database/` |
| `shellsmash/srcs/requirements/monitoring/` | `infra/monitoring/` |
| `shellsmash/srcs/requirements/portainer/` | `infra/portainer/` |
| `shellsmash/srcs/requirements/redis/` | `infra/redis/` |
| `shellsmash/srcs/requirements/reverse_proxy/` | `infra/reverse-proxy/` |
| `shellsmash/srcs/networks/` | eliminar si solo contiene documentacion antigua o mover a `docs/old_docs/infra-networks/` |

Despues de mover infraestructura, actualizar `docker-compose.yml`:

- `./requirements/frontend` -> `./frontend`
- `./requirements/backend` -> `./backend`
- `./requirements/reverse_proxy` -> `./infra/reverse-proxy`
- `./requirements/database` -> `./infra/database`
- `./requirements/redis` -> `./infra/redis`
- `./requirements/monitoring` -> `./infra/monitoring`
- `./requirements/portainer` -> `./infra/portainer`
- `./secrets/nginx_ssl` se mantiene como `./secrets/nginx_ssl`

## Fases de ejecucion

### Fase 0: preparacion

1. Crear una rama dedicada: `refactor/project-structure`.
2. Confirmar que el estado actual compila y levanta antes de mover nada.
3. Guardar un inventario de archivos con `git ls-files`.
4. Revisar `.gitignore` para asegurar que `node_modules/`, `dist/`, logs, `.env` y secretos no entren al repo.

### Fase 1: consolidar documentacion

1. Crear `shellsmash/docs/old_docs/`.
2. Mover el `docs/` antiguo de la raiz dentro de `shellsmash/docs/old_docs/root_docs/` si se mantiene `shellsmash/`.
3. Si se aplica la opcion A, mover primero `shellsmash/docs/` a `docs/` y despues archivar el `docs/` antiguo en `docs/old_docs/`.
4. Eliminar duplicados solo despues de comparar contenido.

Validacion:

- Existe una sola carpeta activa de docs.
- Los documentos historicos estan bajo `old_docs/`.
- Los enlaces internos de `README.md` apuntan al nuevo `docs/`.

### Fase 2: raiz y orquestacion

1. Promover el Makefile actualizado.
2. Mover `docker-compose.yml` y `docker-compose.override.yml` a la raiz.
3. Mover `.env.example`, `.gitignore`, `.sonarcloud.properties`, `README.md`, `scripts/` y `secrets/`.
4. Ajustar rutas internas del Makefile:
   - `COMPOSE_FILE := docker-compose.yml`
   - `OVERRIDE_FILE := docker-compose.override.yml`
   - `CERT_DIR := secrets/nginx_ssl`
5. Ajustar rutas del script de certificados si asume que vive dentro de `shellsmash/`.

Validacion:

- `make help` funciona desde la raiz.
- `make ps` usa los compose files de la raiz.
- No quedan Makefiles duplicados salvo que haya una razon documentada.

### Fase 3: frontend React/Vite

1. Crear `frontend/`.
2. Mover configuracion de Vite y Node a `frontend/`.
3. Mover codigo de React/Phaser a `frontend/src/`.
4. Reubicar `hub/` como feature: `frontend/src/features/hub/`.
5. Reubicar `network/` como servicio: `frontend/src/services/network/`.
6. Mover `styles.css` a `frontend/src/styles/global.css` y actualizar el import.
7. No mover `node_modules/` ni `dist/`; regenerarlos.

Validacion:

- `cd frontend && npm install`.
- `cd frontend && npm run build`.
- El Dockerfile construye con el nuevo contexto.
- Vite resuelve `index.html`, `main.tsx` y assets correctamente.

### Fase 4: backend NestJS

1. Crear `backend/`.
2. Mover configuracion Node/Nest a `backend/`.
3. Colapsar `backend/src/src` en `backend/src`.
4. Mover modulos de dominio a `backend/src/modules/`.
5. Mantener `main.ts`, `app.module.ts` y `app.controller.ts` directamente en `backend/src/`.
6. Mover migraciones a `backend/src/migrations/`.
7. Crear `common/`, `config/` y `database/` solo si hay codigo transversal real para colocar ahi.
8. Actualizar imports relativos y paths de TypeScript.

Validacion:

- `cd backend && npm install`.
- `cd backend && npm run build`.
- `cd backend && npm test`.
- TypeORM encuentra entidades y migraciones en la nueva ruta.

### Fase 5: public assets

1. Crear `public/assets/`.
2. Mover concept art a `public/assets/concept-art/`.
3. Mover texturas compartidas a `public/assets/textures/`.
4. Definir si el frontend consume assets via import o URL publica.
5. Actualizar referencias en Phaser, React, Nginx y docs.

Validacion:

- Los assets cargan en desarrollo.
- Los assets cargan en produccion tras `npm run build`.
- Nginx no apunta a rutas antiguas.

### Fase 6: infraestructura

1. Crear `infra/`.
2. Mover servicios no app desde `srcs/requirements/` a `infra/`.
3. Actualizar contextos Docker en `docker-compose.yml`.
4. Actualizar mounts de configuracion de Nginx, Prometheus, Grafana y Redis.
5. Revisar healthchecks despues de los movimientos.

Validacion:

- `docker compose config` no devuelve errores.
- `make build` construye todas las imagenes.
- `make up` levanta reverse proxy, frontend, backend, database, redis y monitoring.
- `make ps` muestra servicios healthy o en el estado esperado.

### Fase 7: limpieza final

1. Eliminar `shellsmash/` si se aplico la opcion A y ya no contiene nada necesario.
2. Eliminar `srcs/requirements/` si todo fue migrado.
3. Eliminar docs duplicados tras archivar historicos.
4. Revisar referencias antiguas con busquedas:
   - `shellsmash/`
   - `srcs/`
   - `requirements/`
   - `concept_art/`
   - `assets/textures/`
5. Actualizar README con la nueva estructura y comandos.

Validacion:

- `rg "shellsmash/|srcs/requirements|concept_art|assets/textures"` solo devuelve menciones historicas en `docs/old_docs/` o este plan.
- El proyecto se puede levantar desde la raiz con `make up`.
- El proyecto se puede desarrollar con `make dev`.

## Orden recomendado de commits

1. `docs: add restructuring plan`
2. `chore: consolidate active documentation`
3. `chore: promote project root files`
4. `chore: move frontend to top-level app folder`
5. `chore: move backend to top-level app folder`
6. `chore: move shared assets to public`
7. `chore: move infrastructure to infra`
8. `chore: update docker and makefile paths`
9. `docs: update readme for new structure`

## Criterios de finalizacion

La reestructuracion se considera terminada cuando:

- La raiz del repo contiene `Makefile`, `docker-compose.yml`, `docker-compose.override.yml`, `README.md`, `.env.example`, `docs/`, `public/`, `frontend/`, `backend/`, `infra/`, `scripts/` y `secrets/`.
- No existe una carpeta envoltorio innecesaria con codigo real dentro.
- Solo hay una documentacion activa: `docs/`.
- La documentacion antigua esta archivada bajo `docs/old_docs/`.
- Frontend y backend tienen sus propios `package.json` en la raiz de cada app.
- No hay `src/src`.
- No hay `node_modules/` ni `dist/` versionados.
- `make dev`, `make build`, `docker compose config`, `npm run build` en frontend y backend, y los tests del backend pasan.

## Riesgos

- Docker Compose depende de muchas rutas relativas; mover archivos sin actualizar contextos rompera builds.
- El frontend puede tener rutas de assets hardcodeadas.
- NestJS puede tener imports relativos que fallen al mover modulos bajo `modules/`.
- TypeORM puede dejar de encontrar entidades o migraciones si usa globs antiguos.
- Los docs antiguos pueden tener enlaces relativos que apunten fuera de `old_docs/`.
- El Makefile de la raiz y el de `shellsmash/` no son identicos; hay que conservar el mas actualizado.

## Regla de trabajo

Cada fase debe ser un movimiento pequeno, verificable y reversible con Git. No mezclar reordenamiento de archivos con cambios funcionales. Si aparece un bug durante el movimiento, primero terminar de restaurar la compilacion y despues abrir una tarea separada para corregir comportamiento.
