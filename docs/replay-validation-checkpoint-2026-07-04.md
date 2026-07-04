# Replay Validation Checkpoint - 2026-07-04

Este checkpoint documenta la aplicacion de la fase 7 del plan de reparacion de replays. La fase cierra el ciclo con pruebas automatizadas de contrato, normalizacion, playback y resolucion visual, mas una matriz manual documentada para validacion de producto.

## Cambios Aplicados

### Backend

- `backend/src/modules/matchmaking/replay.service.spec.ts`
  - Cubre normalizacion de frames importados.
  - Cubre imports validos para:
    - Temple Curling.
    - Bamboo Bash.
    - Kame Knock.
    - Bell Clash.
  - Cubre rechazo de imports sin `entities` en juegos de proyectiles.
  - Cubre rechazo de `winnerSide` que no existe en `players`.

### Frontend

- `frontend/src/games/shared/replayVisuals.ts`
  - Extrae resolucion pura de jugador activo y fondo activo desde `ReplayScene`.
  - Mantiene `night_bg` como fallback.
  - Normaliza `cycle_bg` a `night_cycle_bg`.

- `frontend/src/games/shared/replayVisuals.test.ts`
  - Cubre resolucion por `currentTurn`.
  - Cubre resolucion por `activeStoneId`.
  - Cubre resolucion por `activeBallIdBySide`.
  - Cubre fallback al ultimo jugador activo.
  - Cubre prioridad de `hubBackgroundAlter`.
  - Cubre fallback para fondos desconocidos.

- `frontend/src/games/shared/ReplayController.test.ts`
  - Cubre avance por duracion grabada.
  - Cubre parada al ultimo frame.
  - Cubre seek con progreso acotado.
  - Cubre filtrado temporal de eventos.

- `frontend/src/games/shared/localReplay.test.ts`
  - Cubre normalizacion local a contrato v1.
  - Cubre compactacion de imports manteniendo primer y ultimo frame.
  - Cubre metadata visual de jugadores locales.
  - Cubre metadata visible de powerups en entidades.
  - Cubre resolucion de ganador local.

## Matriz Manual Documentada

La matriz manual queda como checklist de producto para confirmar en navegador:

- Temple Curling online multiplayer.
- Temple Curling local-versus.
- Temple Curling singleplayer importado.
- Kame Knock online multiplayer.
- Kame Knock local-versus.
- Kame Knock singleplayer importado.
- Bamboo Bash online multiplayer.
- Bamboo Bash local-versus.
- Bamboo Bash singleplayer importado.
- Bell Clash online multiplayer.
- Bell Clash local-versus.
- Bell Clash singleplayer importado.

En cada caso se debe comprobar:

- duracion total del replay;
- orden de turnos;
- fondo por jugador activo;
- persistencia de entidades al hacer seek;
- interpolacion sin saltos graves;
- trails visibles;
- score;
- final de partida;
- powerups visibles y aplicados;
- pickups visibles cuando correspondan;
- compatibilidad con pausa, play y seek.

## Validacion Ejecutada

- `backend npx jest src/modules/matchmaking/replay.service.spec.ts --runInBand`: OK.
- `frontend npm run test:run -- src/games/shared/ReplayController.test.ts src/games/shared/localReplay.test.ts src/games/shared/replayVisuals.test.ts`: OK.
- `backend npm run build`: OK.
- `frontend npm run build`: OK.

## Notas

- La suite frontend requirio instalar dependencias declaradas en `frontend/package.json`; `vitest` no estaba presente en `frontend/node_modules`.
- La instalacion no modifico `frontend/package.json` ni `frontend/package-lock.json`.
- No se marca avance funcional nuevo en `docs/modules-progress.md` porque el modulo de historial/replays ya estaba en estado `Hecho`; esta fase anade cobertura y validacion.
