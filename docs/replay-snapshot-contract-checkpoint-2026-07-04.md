# Checkpoint Replay Snapshot Contract

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 3 del plan de reparacion de replays. La fase completa la base de snapshots para que `entities` exista como mirror canonico de actores renderizables, manteniendo `balls` y `objects` por compatibilidad.

## Cambios Aplicados

### Backend Online

- `backend/src/modules/matchmaking/matchmaking.types.ts`
  - `CurlingSnapshot` ahora incluye `entities`.
  - Los snapshots de Bamboo Bash, Kame Knock y Bell Clash ya tenian `entities`, `balls`, `activeBallIdBySide` y `nextBallId` en backend.

- `backend/src/modules/matchmaking/engines/shell-curl.engine.ts`
  - El estado inicial de Temple Curling arranca con `entities: []`.
  - Al cerrar un end, se limpian `objects` y `entities` juntos para evitar mirrors obsoletos.

- `backend/src/modules/matchmaking/replay-state.helpers.ts`
  - Se anade mirror de stones de Temple Curling desde `objects` hacia `entities`.
  - `initializeCurlingReplayStone` actualiza `entities`.
  - `syncCurlingReplayStateFromPayload` actualiza `entities` despues de sanear `objects`.

### Frontend Tipos

- `frontend/src/services/network/gameSocket.ts`
  - `CurlingSnapshot` acepta `entities` y `activeStoneId`.
  - Los objetos de curling aceptan campos visuales completos: tipo, owner, rotacion, escala, visibilidad, alpha, sprite, flags, timestamps, stopped y trail.
  - Bamboo Bash, Kame Knock y Bell Clash exigen `activeBallIdBySide`, `nextBallId` y `entities` en frontend para reflejar el contrato backend.

### Frontend Local

- `frontend/src/games/shared/localReplay.ts`
  - Se anade `replayBallToEntity`.
  - Se anade `replayStoneToEntity`.
  - Ambos helpers conservan `power`, `scale`, `visible`, `alpha`, `spriteKey`, `stateFlags`, `stopped` y `trail`.

- `frontend/src/games/shell-curl/ShellCurlScene.ts`
  - Los snapshots locales calculan `objects` una sola vez.
  - `entities` se deriva desde `objects` con `replayStoneToEntity`.

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
  - Los snapshots locales calculan `balls` una sola vez.
  - Cada ball local incluye tipo, owner, rotacion, alpha, sprite, flags, stopped, power, scale y trail.
  - `entities` se deriva desde `balls` con `replayBallToEntity`.

- `frontend/src/games/kame-knock/KameKnockScene.ts`
  - El snapshot local incluye `activeBallIdBySide`, `nextBallId` y `entities`.
  - La ball local incluye tipo, owner, rotacion, alpha, sprite, flags, stopped, power, scale y trail.

- `frontend/src/games/bell-clash/BellClashScene.ts`
  - Los snapshots locales calculan `balls` una sola vez.
  - Cada ball local incluye tipo, owner, rotacion, alpha, sprite, flags, stopped, power, scale y trail.
  - `entities` se deriva desde `balls` con `replayBallToEntity`.

## Estado Del Contrato Tras Fase 3

- Temple Curling:
  - `objects` sigue existiendo por compatibilidad.
  - `entities` mirror representa stones renderizables.
  - `activeStoneId` se mantiene.

- Bamboo Bash:
  - `balls` sigue existiendo por compatibilidad.
  - `entities` mirror representa projectiles renderizables.
  - `activeBallIdBySide` y `nextBallId` se mantienen.

- Kame Knock:
  - `balls` sigue existiendo por compatibilidad.
  - `entities` mirror representa projectiles renderizables.
  - `activeBallIdBySide` y `nextBallId` se mantienen tambien en local.

- Bell Clash:
  - `balls` sigue existiendo por compatibilidad.
  - `entities` mirror representa projectiles renderizables.
  - `activeBallIdBySide` y `nextBallId` se mantienen.

## Compatibilidad

- `ReplayScene` puede seguir leyendo `objects` y `balls`.
- Los snapshots nuevos ya traen `entities` para avanzar hacia render principal por entidad.
- Los replays antiguos sin `entities` siguen usando fallback existente.
- No hay migracion de base de datos.

## Lo Que No Cambia Todavia

- No se elimina la lectura legacy de `balls`/`objects`.
- No se elimina simulacion derivada de `ReplayScene`.
- No se auditan todavia todos los powerups visibles.
- No se endurece la validacion de imports.

## Siguiente Paso

Aplicar la fase 4: powerups.

Trabajo recomendado:

1. Auditar cada powerup contra su efecto visible en snapshot.
2. Asegurar que `rocket`, `giant`, `tiny`, `spinning`, `ghost`/`phantom`, `splitter` y `mirror` quedan expresados en `entities`.
3. Persistir pickups visibles cuando correspondan.
4. Evitar que `ReplayScene` tenga que recalcular efectos de powerups.
5. Crear pruebas unitarias o fixtures de snapshot con powerups activos.

## Validacion Realizada

- `backend`: `npm run build`.
- `frontend`: `npm run build`.
- ESLint sobre archivos backend tocados.
