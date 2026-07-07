# Checkpoint Replay Contract V1

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 1 del plan de reparacion de consistencia de replays. La fase introduce un contrato v1 compatible para frames, eventos, jugadores visuales y entidades de replay, sin cambiar todavia la logica de render ni la captura especifica de cada juego.

## Cambios Aplicados

### Backend

- `backend/src/modules/matchmaking/entities/match-replay.entity.ts`
  - Se anade `REPLAY_CONTRACT_VERSION = 1`.
  - Se anade `ReplayContractVersion`.
  - Se define `MatchReplayVisualPlayer` con `turtleName`, `shellSkin`, `hubBackground` y `hubBackgroundAlter`.
  - Se define `MatchReplaySnapshotEntity` con campos visuales base: posicion, velocidad, rotacion, radio, power, escala, flags, visibilidad, alpha, sprite y trail.
  - Se define `MatchReplaySnapshot` como base comun flexible para snapshots actuales y legacy.
  - `MatchReplayFrame` y `MatchReplayEvent` aceptan `replayVersion`.
  - `recordedAtMs`, `tickTs` y `deltaMs` quedan opcionales para poder leer replays antiguos.

- `backend/src/modules/matchmaking/replay.service.ts`
  - Los frames capturados en multiplayer se guardan con `replayVersion: 1`.
  - Los eventos capturados en multiplayer se guardan con `replayVersion: 1`.
  - Los imports singleplayer/local se normalizan para completar `replayVersion`, `recordedAtMs`, `tickTs` y `deltaMs` cuando falten.
  - Los resumenes/detalles de replay exponen `replayVersion`, derivado del primer frame o evento que lo contenga.
  - Si un replay antiguo no tiene version, la API devuelve `replayVersion: null`.

- `backend/src/modules/matchmaking/matchmaking.types.ts`
  - Se anade el tipo `ReplayContractVersion`.
  - `SnapshotPlayer` admite metadata visual opcional.
  - `ReplayFrameSnapshotEntity` y `BallSnapshotData` admiten campos visuales necesarios para el contrato v1.
  - Los buffers de replay del room admiten `replayVersion`.

### Frontend

- `frontend/src/features/hub/api.ts`
  - Se anade `ReplayContractVersion`.
  - Se define `ReplayVisualPlayer`.
  - Se define `ReplaySnapshotEntity`.
  - Se define `ReplayFrameSnapshot`.
  - `ReplayFrame` incluye `replayVersion`, `recordedAtMs`, `tickTs` y snapshot tipado.
  - `ReplayEvent` incluye `replayVersion`, `recordedAtMs` y `tickTs`.
  - `ReplaySummary` expone `replayVersion`.

- `frontend/src/services/network/gameSocket.ts`
  - Se anade `ReplayContractVersion`.
  - Los tipos de snapshot aceptan metadata visual opcional de jugador.
  - `BallSnapshotData` y `ReplayFrameSnapshotEntity` admiten campos visuales base del contrato v1.

- `frontend/src/games/shared/localReplay.ts`
  - La normalizacion de frames locales anade `replayVersion: 1`.
  - Se completan `recordedAtMs` y `tickTs` desde `recordedAt`.

## Compatibilidad

La fase 1 mantiene compatibilidad con replays antiguos:

- `replayVersion` es opcional en frames/eventos persistidos.
- La API expone `replayVersion: null` para replays legacy.
- Los tiempos historicos que no tengan `recordedAtMs`, `tickTs` o `deltaMs` siguen siendo validos.
- No se modifica la tabla `match_replays`; el contrato v1 vive dentro del JSON de `frames` y `events`.
- `ReplayScene` todavia puede usar sus rutas actuales de snapshot/fallback.

## Lo Que No Cambia Todavia

Esta fase no resuelve todavia:

- Persistencia real de `hubBackground`, `hubBackgroundAlter`, `shellSkin` y `turtleName` en todos los snapshots.
- Cambio de fondo por jugador activo.
- Eliminacion de simulacion derivada en `ReplayScene`.
- Validacion estricta de imports por juego.
- Inventario completo de campos reales emitidos por cada minijuego.
- Garantia de que todos los powerups visibles llegan ya aplicados en snapshot.

## Riesgos Pendientes

- Algunos snapshots actuales pueden no llenar los campos nuevos aunque el tipo ya los permita.
- `replayVersion: 1` marca el contrato base, pero no garantiza todavia fidelidad visual completa hasta aplicar fases 2 y 3.
- La importacion normaliza tiempos y version, pero aun no rechaza snapshots incompletos.

## Siguiente Paso

Aplicar la fase 2: metadata visual y fondo activo.

Trabajo recomendado:

1. Persistir metadata visual por jugador en snapshots/replays nuevos: `hubBackground`, `hubBackgroundAlter`, `shellSkin`, `turtleName`.
2. Definir un helper comun para resolver jugador activo por frame desde `currentTurn`, `activeStoneId`, `activeBallIdBySide` o fallback estable.
3. Hacer que `ReplayScene` cambie el fondo cuando cambie el jugador activo.
4. Usar `night_bg` como fallback cuando falte metadata visual.
5. Crear pruebas unitarias del helper de resolucion de jugador activo y fondo.

## Validacion Recomendada Para La Siguiente Fase

- Crear un replay multiplayer nuevo y confirmar que sus frames tienen `replayVersion: 1`.
- Importar un replay local y confirmar que sus frames tienen `replayVersion: 1`, `recordedAtMs`, `tickTs` y `deltaMs`.
- Abrir un replay antiguo y confirmar que sigue cargando con `replayVersion: null`.
- Verificar que el visor no cambia comportamiento hasta introducir la fase 2.
