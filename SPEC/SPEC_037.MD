# SPEC-037 — Platform Grounding

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 → SPEC-036
- Código existente en `main` (costuras verificadas directamente sobre `backend/src/modules/`)

---

# Objetivo

Anclar todas las SPEC anteriores a la plataforma real (NestJS + TypeORM + Socket.IO + PostgreSQL + React/Phaser).

Cuando una SPEC sea abstracta y este documento sea concreto, este documento decide la implementación.

Ningún subagente inventa estructura: la estructura está aquí.

---

# Backend — Módulo

Todo el Tournament vive en un único módulo NestJS nuevo:

`backend/src/modules/tournaments/`

Registrado en `app.module.ts` como el resto de features.

Estructura interna por subcarpetas (runtime/, board/, economy/, config/, etc.), pero un solo módulo Nest.

Nunca añadir lógica de Tournament a `matchmaking.gateway.ts`, `HomePage.tsx` ni `GameResultsService`.

---

# Backend — Entidades y persistencia

Entidades TypeORM nuevas:

`Tournament`

- id (uuid)
- status (`pending | active | finished | cancelled`)
- configId (id del catálogo de configuración utilizado)
- state (jsonb: snapshot serializado del Runtime, actualizado tras cada transición)
- winnerUserId (nullable)
- createdAt / startedAt / finishedAt

`TournamentParticipant`

- FK tournament (CASCADE)
- FK user (SET NULL, como `match_players`)
- seat / orden de turno
- puntos finales
- outcome

`TournamentMatch`

- FK tournament
- FK `matches.id` (uuid)
- ronda
- propósito (`round_minigame | final_challenge`)

Los minijuegos NUNCA duplican datos de partida: se enlazan a `matches` mediante `TournamentMatch`.

No se añade un tercer `MatchMode`: la tabla puente identifica las partidas de torneo sin tocar los puntos del código que comparan `mode`.

Las partidas de minijuego del torneo se crean con `mode: casual` — nunca afectan al ELO (D5, SPEC-040).

Migración manual obligatoria (como `user_cards`): `synchronize` solo cubre desarrollo.

---

# Backend — Costuras existentes autorizadas

El Tournament consume, y puede ampliar mínimamente con aprobación del Arquitecto:

- `MatchFactoryService` (`matchmaking/match-factory.service.ts`) — creación de partidas.
- `MatchLifecycleEvents` (`matchmaking/match-lifecycle.events.ts`) — suscripción a `started / finished / abandoned / cancelled`.
- Arranque server-initiated (patrón de `launchPrivateMatch` / rematch) — inicio sin ready-check manual.
- Primitivas provably-fair (`casino/casino.fair.ts`) — resolución del Gambling (SPEC-016).
- `NotificationsService` — nuevos `type` de notificación de torneo.

MatchLifecycleEvents es best-effort y en memoria: el Tournament debe reconciliar desde la tabla `matches` en `onModuleInit` (mismo patrón que `GameSessionService`).

---

# Backend — Tiempo real

Los handlers `tournament:*` viven en el módulo de Tournament (gateway propio o servicio con handlers delegados), nunca en `matchmaking.gateway.ts`.

Autenticación, cookie JWT y path `/ws/` se reutilizan tal cual.

Salas Socket.IO: una por Tournament (`tournament:<id>`).

Los contratos de eventos WS se definen en un único archivo de tipos del módulo y se espejan conscientemente en el frontend (riesgo conocido de duplicación front/back: mantener sincronizado a mano y documentado, y verificado con el script de comprobación estructural de `scripts/` en la checklist de integración, SPEC-032).

---

# Entrada de jugadores

v1: lobby privado por invitación, siguiendo el molde de `PrivateLobbiesService`.

El flujo completo de entrada (REST, lobby, invitaciones, arranque) se especifica en SPEC-038.

Esto cubre el requisito del módulo del subject: registro y gestión de participantes, orden de enfrentamientos visible.

Cola pública de Tournament: extensión futura.

Guests excluidos (misma política que ranked).

---

# Recompensas persistentes del ganador

Al finalizar el Tournament con ganador (estado REWARDS) — D10, SPEC-040:

- Monedas al campeón: 500 (el valor vive en el catálogo), transacción con `lockUserForUpdate`, como todo escritor de `users.coins`.
- Logro "THE PARROT'S SHELL" mediante el sistema de `achievements` (definición declarativa nueva).
- Sin cosmético conmemorativo en v1; podrá añadirse en el futuro mediante `CustomizationService.grantCosmetic`.
- El resto de jugadores no recibe premio de torneo: ya cobran XP/monedas por cada minijuego mediante el flujo existente.

Si la partida termina en derrota colectiva (DEFEAT, SPEC-001): no se entrega ningún premio persistente; `winnerUserId` queda nulo y el status es `finished`.

Nunca crear un segundo sistema de recompensas persistentes.

Los stats por minijuego (XP, ELO si aplica) ya los gestiona el flujo existente por partida: no tocar.

---

# Frontend

- Feature aislada: `frontend/src/features/tournaments/` (lobby, bracket/progreso, HUD React).
- El tablero se renderiza con una escena Phaser propia siguiendo el patrón de `games/` (incluyendo `shared/hidpi.ts` y el wiring de `shutdown`).
- Punto de entrada: el botón "Tournament" placeholder existente en HomePage.
- Red: `getGameSocket` existente + `apiFetch` para el REST nuevo.
- La UI nunca calcula estado: representa snapshots y eventos (SPEC-022).

---

# Configuración

Catálogos declarativos TypeScript dentro del módulo (`tournaments/config/`), patrón `achievements.constants.ts`:

boards, tiles, dice, items, shop catalogs, random events, rules, boss, final challenge, key items, settings.

Validación cruzada al boot (patrón `validateAchievementCosmeticRewards`).

---

# Riesgo conocido — netcode de arena

La migración server-authoritative (`c426caad`) está incompleta: colisiones/pickups/scoring de los juegos de arena siguen parcialmente en cliente.

El Tournament no debe lanzarse a producción competitiva hasta que esa migración se estabilice, o debe aceptarse explícitamente la salvedad.

Esta decisión pertenece al usuario, no a los subagentes.

---

# Documentación obligatoria

Al implementar el módulo, actualizar `docs/modules-progress.md` (Minor: Tournament system) según la regla de `CLAUDE.md`.

---

# Criterios de aceptación

✓ Todo el código nuevo vive en `modules/tournaments/` y `features/tournaments/` (más la escena Phaser del tablero).

✓ El estado del Tournament es reconstruible desde Postgres.

✓ Las partidas de minijuego se enlazan por tabla puente, sin nuevo MatchMode.

✓ Solo se amplían las costuras autorizadas de los módulos existentes.

✓ Las recompensas persistentes usan exclusivamente los sistemas existentes.
