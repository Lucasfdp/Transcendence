# Checkpoint De Extraccion De Codigo Comun Entre Minijuegos

## Contexto
Este checkpoint resume lo ejecutado a partir de `docs/games-common-code-audit.md` durante las fases 1, 2 y 3 de extraccion sobre la familia `arena + ball` y el soporte compartido relacionado.

Fecha de checkpoint: `2026-07-06`

## Alcance Aplicado
- Frontend:
  - `frontend/src/games/bamboo-bash/BambooBashScene.ts`
  - `frontend/src/games/kame-knock/KameKnockScene.ts`
  - `frontend/src/games/bell-clash/BellClashScene.ts`
  - `frontend/src/games/shell-curl/ShellCurlScene.ts`
  - `frontend/src/games/shared/localReplay.ts`
  - `frontend/src/shared/mechanics/*`
- Backend:
  - `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`
  - `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`
  - `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`
  - `backend/src/modules/matchmaking/engines/base-arena.engine.ts`

## Extraccion Real Completada

### 1. Configuracion visual comun de jugador
Estado: `Hecho`

Se extrajo:
- `frontend/src/shared/mechanics/player-config.ts`

Que centraliza:
- skins por defecto
- resolucion comun de `shellSkins` desde registry

Impacto:
- elimina la repeticion de arrays base de skins en las cuatro escenas auditadas
- deja una entrada unica para la configuracion visual minima por jugador

Limite actual:
- no existe todavia un `PlayerEntityConfig` completo con `spriteKey`, `alpha`, `trailColor`, `renderMode` y `stateFlags`

### 2. Adaptador comun de HUD para flujo de ronda
Estado: `Hecho`

Se extrajo:
- `frontend/src/shared/mechanics/round-flow-hud.ts`

Que centraliza:
- construccion de `TurnState` desde un estado de ronda generico

Impacto:
- elimina el mapping repetido hacia `ScoreHud` en `bamboo-bash`, `kame-knock` y `bell-clash`

Limite actual:
- el flujo de ronda sigue siendo local a cada escena
- no existe todavia `GameRuleHooks`

### 3. Runtime compartido de replay local
Estado: `Hecho`

Se extrajo en:
- `frontend/src/games/shared/localReplay.ts`

Piezas nuevas:
- `SceneReplayRecorder<TSnapshot>`
- `buildLocalReplayImportRequest()`

Impacto:
- elimina la repeticion de:
  - `initLocalReplayRecording()`
  - acumuladores de tiempo de replay
  - captura periodica de frames
  - compactacion de frames
  - construccion del payload de importacion
- deja local por escena solo la construccion del snapshot

Cobertura:
- `frontend/src/games/shared/localReplay.test.ts`

### 4. Base comun para engines backend de arena
Estado: `Hecho`

Se extrajo:
- `backend/src/modules/matchmaking/engines/base-arena.engine.ts`

Que centraliza:
- arranque comun de room de arena
- sync de `seq`
- refresh de `players`
- busqueda de jugador por `userId`
- resolucion de ganador por score
- resolucion de abandono
- bloque comun de replay entities/bballs iniciales

Impacto:
- reduce duplicacion estructural en `bamboo-bash.engine.ts`, `kame-knock.engine.ts` y `bell-clash.engine.ts`

Limite actual:
- no absorbe aun hooks de scoring, release validation, settle flow ni round progression avanzada

### 5. Runtime comun del ciclo de powers para juegos `arena + ball`
Estado: `Hecho` en primera iteracion util

Se extrajo:
- `frontend/src/shared/mechanics/arena-power-runtime.ts`

Que centraliza:
- aplicacion del power de bola al release
- creacion de bolas auxiliares para `SPLITTER` y `MIRROR`
- update comun de bolas extra con friccion y curl
- colisiones comunes entre bolas base y bolas extra
- render comun del pool de bolas extra
- limpieza comun de texturas auxiliares

Impacto:
- reduce duplicacion funcional fuerte entre `bamboo-bash`, `kame-knock` y `bell-clash`
- `KameKnockScene` pasa a usar el mismo shape de `powerBalls` que los otros juegos: `{ ball, player }[]`

Cobertura:
- `frontend/src/shared/mechanics/arena-power-runtime.test.ts`

Limite actual:
- los efectos al detenerse siguen siendo locales por juego
- la logica de pickups, scoring y efectos de mundo sigue enganchada desde cada escena

## Estado Actual Por Area

### Ya extraido de forma util
- `Player visual config` basica
- `HUD adapter`
- `Scene replay recorder`
- `Replay import payload builder`
- `Base arena engine`
- `Ball power cycle` para la familia `arena + ball`

### Extraido parcialmente pero no cerrado
- `PlayerEntityConfig`
  - hoy solo cubre skins por defecto y resolucion de shell skin
- `BaseArenaEngine`
  - hoy cubre lifecycle comun basico, no hooks de reglas
- `ArenaPowerRuntime`
  - hoy cubre spawn/update/render/collision de bolas extra, no todo el ecosistema de powers

### Aun no extraido
- `ObstacleDescriptor`
- `CollectibleDescriptor`
- `GameRuleHooks`
- `LaunchableActor`
- contrato comun frontend/backend de `LaunchSnapshotEntity` y `WorldObjectSnapshot`

## Duplicacion Importante Que Sigue Viva

### Gameplay y reglas
- flujo de ronda/turno especifico en `bamboo-bash`, `kame-knock` y `bell-clash`
- reglas de scoring locales
- deteccion de impactos en objetos de mundo
- reglas de fin de ronda o fin de tiro

### Objetos de mundo
- bambu
- targets temporales
- campana y zonas angulares
- bumpers de curling

### Pickups e integracion
- el manager visual de pickups ya era compartido
- sigue local la integracion por escena y el pegado con payloads backend

### Contratos de snapshot
- hay compatibilidad practica
- sigue habiendo estados y payloads ad hoc por juego

## Riesgos O Puntos Delicados
- La familia `arena + ball` esta mejor consolidada, pero todavia no hay una escena base comun. Eso sigue siendo intencional para no forzar una jerarquia prematura.
- `shell-curl` comparte ahora mas infraestructura auxiliar, pero su fisica y reglas siguen separadas, y conviene mantenerlo asi.
- La validacion ejecutable de este checkpoint no se pudo completar en esta sesion porque el entorno no tiene `npm`. La revision realizada fue estatica y de consistencia de referencias.

## Siguiente Secuencia Recomendada

### Fase 4 recomendada
- Extraer `ObstacleDescriptor`
- Empezar por un contrato de datos comun, no por una clase base de objetos
- Cubrir primero:
  - targets de `kame-knock`
  - bambu de `bamboo-bash`
  - zonas y campana de `bell-clash`

### Fase 5 recomendada
- Extraer `CollectibleDescriptor`
- Unificar pickup effect + serializacion + integracion backend/frontend

### Fase 6 recomendada
- Extraer `GameRuleHooks`
- Mover a comun:
  - release lifecycle
  - settled lifecycle
  - round progression
  - winner calculation adapter

## Resumen Ejecutivo
La auditoria ya no es solo propuesta: desde este checkpoint existe una capa compartida real para visuales basicos de jugador, adaptacion de HUD, replay local, lifecycle backend de arena y runtime de powers de la familia `arena + ball`.

Lo mas repetido que queda ya no es plumbing comun sino reglas de gameplay y contratos de mundo. Por eso, a partir de aqui, la siguiente extraccion valiosa pasa por `ObstacleDescriptor`, `CollectibleDescriptor` y `GameRuleHooks`, no por seguir metiendo mas helpers tecnicos aislados.

## Estado De Modulos
Se reviso `docs/modules-progress.md` durante este checkpoint. No corresponde actualizarlo porque estos cambios reducen deuda tecnica y duplicacion interna, pero no cambian por si mismos el estado funcional de los modulos del enunciado.
