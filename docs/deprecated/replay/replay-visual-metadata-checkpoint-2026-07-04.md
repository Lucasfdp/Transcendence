# Checkpoint Replay Visual Metadata

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 2 del plan de reparacion de replays. La fase persiste metadata visual por jugador en snapshots nuevos y hace que el visor cambie el fondo segun el jugador activo de cada frame.

## Cambios Aplicados

### Backend Online

- `backend/src/modules/matchmaking/matchmaking.types.ts`
  - `SocketUser` acepta `shellSkin`, `hubBackground` y `hubBackgroundAlter`.
  - `SnapshotPlayer` ya tenia esos campos opcionales desde fase 1 y ahora se rellenan.

- `backend/src/modules/matchmaking/matchmaking.gateway.ts`
  - Al conectar por WebSocket, el usuario de socket incluye:
    - `turtleName`.
    - `shellSkin`.
    - `hubBackground`.
    - `hubBackgroundAlter`.

- `backend/src/modules/matchmaking/engines/base.engine.ts`
  - `toSnapshotPlayer` persiste metadata visual en snapshots de engines online.

- `backend/src/modules/matchmaking/room.service.ts`
  - `refreshSnapshotPlayers` tambien persiste metadata visual durante ready, reconnect, finish y cambios de estado de sala.

### Frontend Local

- `frontend/src/lib/createShellSmashGame.ts`
  - El usuario inicial del juego acepta `shellSkin`, `hubBackground` y `hubBackgroundAlter`.

- `frontend/src/games/shared/localReplay.ts`
  - `buildLocalReplayPlayers` genera jugadores con:
    - `shellSkin`.
    - `hubBackground`.
    - `hubBackgroundAlter`.
  - El jugador local usa sus cosmeticos reales cuando existen.
  - Los jugadores locales secundarios usan `night_bg` como fallback y la skin local asignada por lado cuando existe.

- `frontend/src/games/shell-curl/ShellCurlScene.ts`
- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
- `frontend/src/games/kame-knock/KameKnockScene.ts`
- `frontend/src/games/bell-clash/BellClashScene.ts`
  - Los snapshots locales pasan el mapa `shellSkins` al helper comun.

### ReplayScene

- `frontend/src/games/shared/ReplayScene.ts`
  - Precarga backgrounds de replay:
    - `night_bg`.
    - `night_cycle_bg`.
    - `sunset_bg`.
    - `sunset_cycle_bg`.
    - `sunrise_bg`.
    - `sunrise_cycle_bg`.
  - Resuelve jugador activo por frame con este orden:
    1. `currentTurn`.
    2. `activeStoneId` contra `objects` o `entities`.
    3. `activeBallIdBySide` contra `entities` o `balls`.
    4. ultimo jugador activo conocido.
    5. `side = 0`.
  - Resuelve fondo desde `hubBackgroundAlter` y luego `hubBackground`.
  - Normaliza `cycle_bg` a `night_cycle_bg`.
  - Usa `night_bg` como fallback.
  - Cambia el fondo cuando cambia el jugador activo o su metadata visual.

## Compatibilidad

- Los snapshots antiguos sin metadata visual siguen reproduciendose con `night_bg`.
- Los snapshots antiguos sin campos de jugador activo mantienen el ultimo lado activo conocido o caen a `side = 0`.
- No se elimina ninguna ruta legacy de `ReplayScene`.
- No hay migracion de base de datos.

## Lo Que No Cambia Todavia

- Todavia no se audita que todos los juegos emitan `entities` completas.
- Todavia no se eliminan simulaciones derivadas del visor.
- Todavia no hay validacion estricta de imports por juego.
- Todavia no se garantiza que todos los powerups visibles esten representados por snapshot.

## Siguiente Paso

Aplicar la fase 3: snapshots completos.

Trabajo recomendado:

1. Inventariar por juego que campos reales llegan en `entities`, `balls`, `objects`, targets, zonas y pickups.
2. Normalizar `entities` como fuente canonica para actores renderizables.
3. Mantener `balls` como mirror o compatibilidad donde haga falta.
4. Completar `objects` de Temple Curling sin perder bumpers ni stones.
5. Verificar que trails, `power`, `scale`, `stateFlags`, `visible`, `alpha` y `spriteKey` llegan en todos los actores visibles.

## Validacion Recomendada

- Crear un replay online y confirmar que cada `snapshot.players[]` tiene metadata visual.
- Crear un replay local-versus y confirmar que cada jugador guarda su `shellSkin`.
- Abrir un replay nuevo y confirmar que el fondo cambia cuando cambia el jugador activo.
- Abrir un replay legacy y confirmar que cae a `night_bg` sin romper el visor.
