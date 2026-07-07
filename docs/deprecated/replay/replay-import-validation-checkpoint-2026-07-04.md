# Checkpoint Replay Import Validation

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 6 del plan de reparacion de replays. La fase endurece la importacion singleplayer/local para que los replays persistidos cumplan el contrato v1 antes de llegar al visor.

## Cambios Aplicados

### Backend

- `backend/src/modules/matchmaking/replay.service.ts`
  - Los frames importados se normalizan una sola vez al entrar al flujo.
  - Los eventos importados se normalizan una sola vez al entrar al flujo.
  - El replay normalizado se usa para:
    - validacion de contrato;
    - creacion de participantes;
    - persistencia de `frames`;
    - persistencia de `events`;
    - calculo de `frameCount`.

### Normalizacion

- `replayVersion` se rellena con `1` si falta.
- `seq` se compacta a indice de frame para garantizar timeline monotona.
- `recordedAtMs` se deriva desde `recordedAt` si falta.
- `tickTs` se deriva desde el primer frame si falta.
- `deltaMs` se deriva desde el frame anterior si falta.

### Validacion General

Cada import debe cumplir:

- `gameId` soportado.
- `status` igual a `finished` o `abandoned`.
- `frames` no vacio.
- limite maximo de frames respetado.
- cada frame con `replayVersion: 1`.
- `seq` normalizado.
- `recordedAtMs`, `tickTs` y `deltaMs` finitos y no negativos.
- tiempos no decrecientes.
- `snapshot.gameId` igual al `gameId` del import.
- `snapshot.phase` presente.
- `players` presente y no vacio.
- cada player con `side` valido y `username`.
- `score` o `scores` presente y coherente con numero de jugadores.
- `winnerSide`, cuando existe, debe apuntar a un jugador presente.
- `status: finished` debe terminar con snapshot `phase: finished`.
- `status: abandoned` debe terminar con snapshot `phase: abandoned`.

### Validacion Por Juego

- Temple Curling:
  - `objects` y `entities` deben existir.
  - `currentTurn` debe existir.
  - `entities` debe contener solo entidades `stone` cuando tenga elementos.

- Bamboo Bash:
  - `bamboos` debe existir.
  - `powerPickups` debe existir.
  - `balls`, `entities`, `activeBallIdBySide` y `nextBallId` deben existir.
  - `entities` debe contener solo entidades `projectile` cuando tenga elementos.

- Kame Knock:
  - `targets` debe existir.
  - `currentTurn` debe existir.
  - `balls`, `entities`, `activeBallIdBySide` y `nextBallId` deben existir.
  - `entities` debe contener solo entidades `projectile` cuando tenga elementos.

- Bell Clash:
  - `zones` debe existir.
  - `balls`, `entities`, `activeBallIdBySide` y `nextBallId` deben existir.
  - `entities` debe contener solo entidades `projectile` cuando tenga elementos.

## Compatibilidad

- Replays legacy ya persistidos no se migran ni se rechazan al leerlos.
- La validacion nueva afecta solo a imports nuevos.
- Los imports locales actuales ya generan los campos requeridos por fases 1 a 4.
- La normalizacion permite omitir algunos tiempos siempre que `recordedAt` sea valido.

## Limitaciones Pendientes

- No se valida aun semantica completa de cada entidad, como rangos exactos de arena, `spriteKey` permitido o relacion exacta entre `balls` y `entities`.
- No se validan eventos importados mas alla de su normalizacion temporal.
- No se elimina fallback legacy del visor.

## Siguiente Paso

Aplicar la fase 5: playback principal desde snapshot.

Trabajo recomendado:

1. Hacer que `ReplayScene` use `entities` como ruta principal en todos los juegos.
2. Mantener eventos solo para FX o fallback legacy.
3. Reducir `buildProjectileStatesFromEvents`.
4. Comprobar seek determinista sin reconstruir estado por eventos.
5. Crear fixtures de imports validos e invalidos para cubrir el contrato.

## Validacion Realizada

- `backend`: `npm run build`.
- `frontend`: `npm run build`.
- ESLint sobre `backend/src/modules/matchmaking/replay.service.ts`.
