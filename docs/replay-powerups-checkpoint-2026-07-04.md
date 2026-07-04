# Checkpoint Replay Powerups

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 4 del plan de reparacion de replays. La fase hace que los efectos visibles principales de powerups queden expresados en snapshots, especialmente en `entities`, para que el visor no tenga que recalcular reglas de gameplay.

## Cambios Aplicados

### Backend Online

- `backend/src/modules/matchmaking/replay-state.helpers.ts`
  - Los projectiles de replay guardan `power`.
  - `giant` y `tiny` modifican `scale` en snapshot.
  - `phantom` y `ghost` reducen `alpha` en snapshot.
  - Los powerups anaden `stateFlags` tipo `power:<power>`.
  - Los stones de Temple Curling aplican `scale`, `alpha` y `stateFlags` derivados del power en el snapshot.

- `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`
  - El power consumido se pasa a `initializeArenaReplayBall`.

- `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`
  - El power del payload de release se pasa al snapshot del projectile.

- `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`
  - El power del payload de release se pasa al snapshot del projectile.

### Frontend Local

- `frontend/src/games/shared/localReplay.ts`
  - `replayBallToEntity` y `replayStoneToEntity` aplican metadata visual de power.
  - `withPowerStateFlags` evita duplicar flags y estandariza `power:<power>`.
  - `giant` y `tiny` se reflejan como `scale`.
  - `phantom` y `ghost` se reflejan como `alpha`.

- `frontend/src/games/shell-curl/ShellCurlScene.ts`
  - Stones locales exportan `scale` desde el radio real.
  - Stones locales exportan `alpha` para powers translucidos.
  - Stones locales exportan `stateFlags` con `power:<power>`.

- `frontend/src/games/bamboo-bash/BambooBashScene.ts`
  - Se conserva el power activo de replay por participante.
  - Balls locales exportan `power`, `scale`, `alpha` y `stateFlags`.

- `frontend/src/games/kame-knock/KameKnockScene.ts`
  - Se conserva el power activo de replay para la ball local.
  - La ball local exporta `power`, `scale`, `alpha` y `stateFlags`.

- `frontend/src/games/bell-clash/BellClashScene.ts`
  - Se conserva el power activo de replay por side.
  - Balls locales exportan `power`, `scale`, `alpha` y `stateFlags`.

### ReplayScene

- `frontend/src/games/shared/ReplayScene.ts`
  - `normalizeReplayBalls` prefiere `entities` cuando existen.
  - El estado renderizable de projectiles conserva `alpha`.
  - Las texturas de actores aplican alpha para powers translucidos.

## Cobertura De Powerups

Capturado por snapshot:

- `rocket`: queda marcado en `power` y `stateFlags`; la velocidad ya llega aplicada en runtime/local y se conserva en snapshot.
- `giant`: queda marcado y se representa con `scale`.
- `tiny`: queda marcado y se representa con `scale`.
- `spinning`: queda marcado en `power` y `stateFlags`; la trayectoria/trail se captura desde runtime.
- `ghost`: queda marcado y usa `alpha` translucido.
- `phantom`: queda marcado y usa `alpha` translucido.
- `splitter`: queda marcado como power; las entidades hijas se conservan cuando la escena las produce.
- `mirror`: queda marcado como power; las entidades mirror se conservan cuando la escena las produce.

## Compatibilidad

- `balls` y `objects` siguen existiendo por compatibilidad.
- `entities` es la fuente preferida para projectiles modernos.
- Replays antiguos sin `entities`, `power`, `scale` o `alpha` siguen usando fallbacks actuales.
- No hay migracion de base de datos.

## Limitaciones Pendientes

- La fase no valida estrictamente imports incompletos.
- `ReplayScene` todavia conserva fallback por eventos y simulacion derivada para legacy.
- Algunos powerups scene-level dependen de que la escena haya creado entidades hijas en runtime.

## Siguiente Paso

Aplicar la fase 5: playback principal desde snapshot.

Trabajo recomendado:

1. Reducir el uso de `buildProjectileStatesFromEvents`.
2. Mantener fallback por eventos solo para replays legacy sin `entities`.
3. Hacer que `ReplayScene` use `entities` como ruta principal en los cuatro juegos.
4. Confirmar seek determinista sin reproducir eventos previos.
5. Preparar fixtures de replay con powers para comparar playback.

## Validacion Realizada

- `backend`: `npm run build`.
- `frontend`: `npm run build`.
- ESLint sobre archivos backend tocados.
