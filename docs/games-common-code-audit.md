# Auditoria De Codigo Comun Entre Minijuegos

## Objetivo
Responder con evidencia concreta a una pregunta: que codigo comun ya existe entre `shell-curl`, `bamboo-bash`, `kame-knock` y `bell-clash`, que piezas siguen duplicadas o semi-duplicadas, y que se puede extraer con seguridad a una capa compartida sin forzar abstracciones prematuras.

## Alcance Revisado
- Frontend gameplay:
  - `frontend/src/games/shell-curl/ShellCurlScene.ts`
  - `frontend/src/games/bamboo-bash/BambooBashScene.ts`
  - `frontend/src/games/kame-knock/KameKnockScene.ts`
  - `frontend/src/games/bell-clash/BellClashScene.ts`
- Frontend shared:
  - `frontend/src/shared/mechanics/*`
  - `frontend/src/shared/arenas/*`
  - `frontend/src/games/shared/*`
- Backend gameplay y replay:
  - `backend/src/modules/matchmaking/engines/*`
  - `backend/src/modules/matchmaking/replay-state.helpers.ts`
  - `backend/src/modules/matchmaking/matchmaking.types.ts`

## Resumen Ejecutivo
Hay dos familias claras:

| Familia | Juegos | Estado |
| --- | --- | --- |
| `arena + ball + slingshot` | `bamboo-bash`, `kame-knock`, `bell-clash` | Comparten mucha infraestructura real, pero cada escena sigue reimplementando bastante ciclo de ronda, HUD local, pickups y objetos del mundo. |
| `rect-arena + stone + turn-manager` | `shell-curl` | Ya reutiliza varias capas comunes, pero sigue teniendo contratos y reglas propios de curling que no conviene diluir dentro de la familia `ball`. |

La mejor oportunidad inmediata no es fusionar los cuatro juegos bajo una sola escena base, sino consolidar tres zonas:

1. configuracion visual y de jugador
2. contratos de obstaculos/objetivos/coleccionables
3. ciclo compartido de proyectiles, powers, replay y snapshot para juegos de tipo `arena + ball`

## Inventario De Juegos Auditados

### `shell-curl`
- Nucleo propio: sheet rectangular, fisica `stone`, scoring por casa, turnos y ends, sweep, bumpers.
- Capas compartidas ya usadas:
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/score-hud.ts`
  - `shared/mechanics/player-renderer.ts`
  - `shared/mechanics/player-trails.ts`
  - `games/shared/localReplay.ts`
- Diferencia estructural clave: depende de `stone.ts`, `rect-arena.ts` y `turn-manager.ts`, no de `ball.ts` ni de `arena.ts`.

### `bamboo-bash`
- Nucleo propio: bambu que crece, timer de ronda, spawn continuo, scoring por stage.
- Capas compartidas ya usadas:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`
- Diferencia estructural clave: tiene mas estado compartido de partida continua que de turno estricto.

### `kame-knock`
- Nucleo propio: targets temporales, combo, perfect hit, rondas de targets por jugador.
- Capas compartidas ya usadas:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/timed-targets.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`
- Diferencia estructural clave: mezcla turno por jugador con reglas de targets regenerados por ronda.

### `bell-clash`
- Nucleo propio: campana central, zonas angulares, puntuacion por impacto, tres tiros por ronda.
- Capas compartidas ya usadas:
  - `shared/arenas/arena.ts`
  - `shared/mechanics/ball.ts`
  - `shared/mechanics/slingshot.ts`
  - `shared/mechanics/power-pickups.ts`
  - `shared/mechanics/ball-powers.ts`
  - `shared/mechanics/ball-spawn-powers.ts`
  - `games/shared/localReplay.ts`
- Diferencia estructural clave: no comparte ni el modelo de objetivos de `bamboo-bash` ni el de `kame-knock`; solo comparte la capa de proyectil y ronda.

## Mapa De Codigo Comun Ya Extraido

### Frontend Compartido Real

| Dominio | Codigo comun | Evidencia |
| --- | --- | --- |
| Proyectil de arena | Fisica, colision y render basico de bola | `frontend/src/shared/mechanics/ball.ts`; usado por `frontend/src/games/bamboo-bash/BambooBashScene.ts`, `frontend/src/games/kame-knock/KameKnockScene.ts`, `frontend/src/games/bell-clash/BellClashScene.ts` |
| Proyectil de curling | Fisica, colision y render de stone | `frontend/src/shared/mechanics/stone.ts`; usado por `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Lanzamiento | Drag-to-launch compartido | `frontend/src/shared/mechanics/slingshot.ts`; importado por los 4 juegos |
| Arenas elipticas | Geometria y layout responsivo | `frontend/src/shared/arenas/arena.ts`; usado por `bamboo-bash`, `kame-knock`, `bell-clash` |
| Arena rectangular | Geometria de sheet y scoring house | `frontend/src/shared/mechanics/rect-arena.ts`; usado por `shell-curl` |
| Powers | Catalogo, assets y semantica comun | `frontend/src/shared/mechanics/power-system.ts`; `frontend/src/shared/mechanics/game-powers.ts` |
| Pickups | Spawn, colleccion y dibujo de pickups | `frontend/src/shared/mechanics/power-pickups.ts`; usado por los 4 juegos |
| Powers sobre `ball` | Flags y mutaciones compartidas de proyectil | `frontend/src/shared/mechanics/ball-powers.ts`; usado por `bamboo-bash`, `kame-knock`, `bell-clash` |
| Spawn de powers sobre `ball` | Split y mirror | `frontend/src/shared/mechanics/ball-spawn-powers.ts`; usado por `bamboo-bash`, `kame-knock`, `bell-clash` |
| HUD y overlays | `ScoreHud`, overlay de ronda, modal final, rematch online | `frontend/src/shared/mechanics/score-hud.ts`, `round-overlay.ts`, `game-end-modal.ts`, `online-rematch.ts` |
| Visuales de jugador | Texturas in-game y trails | `frontend/src/shared/mechanics/player-renderer.ts`; `frontend/src/shared/mechanics/player-trails.ts` |
| Replay local y visual | Normalizacion de frames, controller y escena de replay | `frontend/src/games/shared/localReplay.ts`; `ReplayController.ts`; `ReplayScene.ts`; `replayVisuals.ts` |

### Backend Compartido Real

| Dominio | Codigo comun | Evidencia |
| --- | --- | --- |
| Contrato de engine | Interfaz comun para engines | `backend/src/modules/matchmaking/engines/game-engine.ts` |
| Registro de engines | Resolucion por `gameId` | `backend/src/modules/matchmaking/engines/game-engine.registry.ts` |
| Jugadores en snapshot | Sincronizacion de `room.players` a `snapshot.players` | `backend/src/modules/matchmaking/engines/base.engine.ts` |
| Contratos de snapshot y replay entity | `GameSnapshot`, `SnapshotPlayer`, `ReplayFrameSnapshotEntity`, `BallSnapshotData` | `backend/src/modules/matchmaking/matchmaking.types.ts` |
| Mirror de replay en juegos de arena | Inicializacion, sync y settle de projectiles | `backend/src/modules/matchmaking/replay-state.helpers.ts`; usado por `bamboo-bash.engine.ts`, `kame-knock.engine.ts`, `bell-clash.engine.ts` |
| Mirror de replay en curling | Inicializacion y sync de stone | `backend/src/modules/matchmaking/replay-state.helpers.ts`; usado por `shell-curl.engine.ts` |

## Matriz De Extraccion Por Dominio

| Componente | Donde existe hoy | Grado de comun | Que extraer | Riesgo | Prioridad | Evidencia |
| --- | --- | --- | --- | --- | --- | --- |
| Capa de proyectil lanzable | `ball.ts` y `stone.ts` con `Slingshot` compartido | `parecido pero acoplado` | Un contrato `LaunchableActor` para lanzamiento, flags visuales y hooks de movimiento; mantener dos motores fisicos separados (`ball` y `stone`) | Medio | Alta | `frontend/src/shared/mechanics/ball.ts`; `frontend/src/shared/mechanics/stone.ts`; `frontend/src/shared/mechanics/slingshot.ts` |
| Configuracion visual de jugador | Cada escena repite arrays de skins/colores y llamadas a `drawIngamePlayerTexture` o `drawIngameShellTexture` | `duplicado` | `PlayerEntityConfig` para skin, color, escala, alpha, spriteKey, trail y reglas de render | Bajo | Alta | `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts`; `frontend/src/shared/mechanics/player-renderer.ts`; `frontend/src/shared/mechanics/player-trails.ts` |
| Obstaculos y objetivos | `bamboo.ts`, `timed-targets.ts`, zonas/campana dentro de `BellClashScene`, bumpers dentro de `ShellCurlScene` | `parecido pero acoplado` | `ObstacleDescriptor` con geometria, colision, scoring, vida y render metadata; cada juego mantiene hooks propios | Medio | Alta | `frontend/src/games/bamboo-bash/bamboo.ts`; `frontend/src/shared/mechanics/timed-targets.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Coleccionables / pickups | Manager compartido pero contratos de pickup locales y payloads backend separados | `ya compartido` en visual/spawn, `duplicado` en integracion | `CollectibleDescriptor` para pickup, efecto y serializacion comun | Bajo | Media | `frontend/src/shared/mechanics/power-pickups.ts`; `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/games/shell-curl/ShellCurlScene.ts` |
| Power loop en juegos no-curling | Los tres juegos de bola repiten `applyBallPower`, split, mirror, pickup consume, flags y replay metadata | `duplicado` | Un `ArenaPowerRuntime` o `BallPowerCycle` compartido para release, pickup, split, mirror y sincronizacion visual | Medio | Alta | `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts`; `frontend/src/shared/mechanics/ball-powers.ts`; `frontend/src/shared/mechanics/ball-spawn-powers.ts` |
| Terreno / arena / colisiones | Oval arena ya compartida; rect arena separada; spawn spots y normalizacion de coordenadas se repiten en objetos de mundo | `ya compartido` parcialmente | Mantener `arena.ts` y `rect-arena.ts` separadas; extraer solo helpers de posicion normalizada y spawn clearance | Bajo | Media | `frontend/src/shared/arenas/arena.ts`; `frontend/src/shared/mechanics/rect-arena.ts`; `frontend/src/shared/mechanics/timed-targets.ts`; `frontend/src/games/bamboo-bash/bamboo.ts` |
| Scoring / turnos / rondas | `TurnManager` solo cubre curling; los otros tres construyen estados tipo ronda/turno a mano | `duplicado` | `GameRuleHooks` + `RoundFlowState` para declarar round, shot, turn, submit y finish sin imponer scoring unico | Medio | Alta | `frontend/src/shared/mechanics/turn-manager.ts`; `frontend/src/games/bamboo-bash/BambooBashScene.ts`; `frontend/src/games/kame-knock/KameKnockScene.ts`; `frontend/src/games/bell-clash/BellClashScene.ts` |
| HUD / overlay / fin de partida | Componentes compartidos, pero cada escena adapta manualmente `TurnState` o genera estructuras equivalentes | `ya compartido` en UI, `duplicado` en adaptadores | Un adapter compartido `buildHudStateFromRoundFlow()` para no rehacer mapping por juego | Bajo | Media | `frontend/src/shared/mechanics/score-hud.ts`; `frontend/src/shared/mechanics/round-overlay.ts`; `frontend/src/shared/mechanics/game-end-modal.ts`; `frontend/src/shared/mechanics/online-rematch.ts` |
| Replay local / snapshot frontend | Capa de replay muy bien extraida, pero cada escena sigue montando entidades y players con codigo parecido | `ya compartido` con duplicacion residual | Extraer un `SceneReplayRecorder` con helpers para players, frames y persistencia local | Bajo | Media | `frontend/src/games/shared/localReplay.ts`; `frontend/src/games/shared/ReplayController.ts`; `frontend/src/games/shared/ReplayScene.ts`; escenas de los 4 juegos |
| Snapshot / replay backend de juegos de arena | Tres engines usan el mismo helper de projectile mirror y estructuras parecidas | `duplicado` en lifecycle, `ya compartido` en replay entity | Un `BaseArenaEngine` para ganador, reset de round, validacion basica de release y hooks de scoring/objetivos | Medio | Alta | `backend/src/modules/matchmaking/replay-state.helpers.ts`; `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`; `kame-knock.engine.ts`; `bell-clash.engine.ts` |
| Snapshot frontend/backend compartido | Contratos compatibles, pero algunos payloads y estados siguen siendo ad hoc por juego | `parecido pero acoplado` | Revisar un contrato comun `LaunchSnapshotEntity` y `WorldObjectSnapshot` para reducir serializaciones distintas | Medio | Media | `backend/src/modules/matchmaking/matchmaking.types.ts`; `frontend/src/games/shared/localReplay.ts`; `frontend/src/games/shared/ReplayScene.ts` |

## Clasificacion Ejecutiva De Refactorizacion

### Extraible Ya
- `PlayerEntityConfig` para agrupar skin, sprite, tamano, escala, alpha y trail.
- `SceneReplayRecorder` para local replay en escenas de juego.
- Adaptador comun para `ScoreHud`, `showRoundTransitionOverlay`, `showGameEndModal` y `showOnlineRematchEndModal`.
- Helpers de posicion normalizada y clearance para objetos de mundo elipticos.

### Extraible Tras Normalizar Interfaz
- `LaunchableActor` como contrato de lanzamiento y flags visuales, no como fisica unica.
- `ObstacleDescriptor` para objetivos, bumpers, bambu, campanas y targets.
- `CollectibleDescriptor` para pickups y otros objetos recogibles.
- `BaseArenaEngine` backend para `bamboo-bash`, `kame-knock` y `bell-clash`.
- `GameRuleHooks` para separar flujo comun de ronda/turno del scoring local.

### Conviene Dejar Local
- Fisica de `stone.ts` frente a fisica de `ball.ts`.
- Scoring de casa en curling.
- Geometria angular de `bell-clash`.
- Crecimiento de bambu por stage.
- Combo y perfect-hit de `kame-knock`.

## Propuesta De Abstracciones Objetivo

### `PlayerEntityConfig` propuesta
Debe centralizar:
- `spriteKey`
- `shellSkin`
- `radius`
- `scale`
- `alpha`
- `trailColor` o `side`
- `renderMode`: `fullPlayer | shellOnly`
- `stateFlags`

Objetivo: dejar de repartir decisiones visuales entre cada escena, `player-renderer.ts`, `player-trails.ts` y el ensamblado de replay.

### `LaunchableActor` propuesta
Debe unificar:
- estado minimo de lanzamiento
- metadata visual comun
- flags de power
- enganche con `Slingshot`

No debe obligar a una sola fisica. `ball.ts` y `stone.ts` pueden seguir con `step*()` separados.

### `ObstacleDescriptor` propuesta
Debe describir:
- id y tipo
- posicion normalizada o absoluta
- radio o bounds
- puntos
- si bloquea, rebota, se rompe o puntua
- metadata de render
- hooks opcionales de `onHit`, `onExpire`, `onScore`

Esto cubriria:
- bambu
- targets de `kame-knock`
- bumpers de `shell-curl`
- campana y zonas de `bell-clash`

### `CollectibleDescriptor` propuesta
Debe describir:
- id
- tipo
- posicion
- radio
- efecto
- reglas de consumo
- serializacion a snapshot

Esto cerraria la brecha entre el `PowerPickupManager` compartido y la integracion todavia repetida en escenas y engines.

### `GameRuleHooks` propuesta
Debe dejar local solo lo que cambia:
- `onRelease`
- `onProjectileSettled`
- `onObstacleHit`
- `onRoundComplete`
- `computeWinner`
- `buildHudState`

Objetivo: extraer flujo, no esconder reglas.

## Hallazgos Concretos De Duplicacion

### 1. Trio `bamboo-bash` / `kame-knock` / `bell-clash`
Es la principal veta de extraccion:
- Comparten `arena.ts`, `ball.ts`, `Slingshot`, `PowerPickupManager`, `applyBallPower`, split/mirror, `ScoreHud`, trails, renderer, replay local y replay backend de projectile.
- Tambien comparten bastante estructura de escena:
  - recreacion o sincronizacion de slingshot
  - reconstruccion de HUD
  - captura de replay
  - aplicacion de pickups
  - fin de ronda y modal final

Conclusion: merece una capa comun especifica para `arena + ball`, no una abstraccion universal de los cuatro juegos.

### 2. `shell-curl` esta menos duplicado de lo que parece
Aunque comparte menos fisica, ya consume muchas capas correctas:
- HUD
- overlays
- slingshot
- pickups
- renderer
- trails
- local replay

Conclusion: el trabajo con `shell-curl` no pasa por "convertirlo" al stack de `ball`, sino por extraer contratos de visuales, pickups, replay y objetos del mundo.

### 3. Backend de arena con fuerte repeticion estructural
`bamboo-bash.engine.ts`, `kame-knock.engine.ts` y `bell-clash.engine.ts` repiten:
- `createInitialState()` con arrays paralelos por jugador
- `start()` con `resetArenaReplayBalls()` y `refreshSnapshotPlayers()`
- validaciones de jugador/sala/fase
- ganador por max score
- integracion con `initializeArenaReplayBall()` y `syncArenaReplayBallFromPayload()`

Conclusion: hay suficiente similitud para un `BaseArenaEngine` con hooks por juego.

## Backlog Priorizado De Extraccion

1. Consolidar configuracion comun de jugador y visuales.
2. Unificar contratos de obstaculos y objetivos.
3. Extraer ciclo comun de powers en escenas no-curling.
4. Reducir duplicacion de HUD, ronda, replay y snapshot.
5. Revisar un contrato backend/frontend compartido para entidades lanzables y objetos del mundo.

## Recomendacion Operativa
La secuencia mas segura es:

1. sacar abstracciones de datos y adaptadores pequenos
2. mover despues el flujo compartido de `arena + ball`
3. dejar para el final cualquier intento de unificar `stone` con `ball`

Hacerlo al reves forzaria una jerarquia demasiado abstracta y aumentaria el riesgo de regresiones en gameplay.

## Estado De Modulos
Se reviso `docs/modules-progress.md` durante esta auditoria. No hay evidencia de un cambio real de estado de modulo; por tanto, no corresponde actualizarlo en esta tarea.
