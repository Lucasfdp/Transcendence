# Kame Knock Replay Reference

## Objetivo

Este documento recopila la parte del proyecto que hizo despegar los replays de `kame-knock` y que ahora sirve como base del flujo de replay local para todos los minijuegos soportados.

Sirve como mapa tecnico para:

- entender el flujo completo del replay
- localizar los archivos relevantes
- depurar por que un replay no se guarda, no aparece o se reproduce mal

## Resumen Del Flujo

Hay dos caminos distintos:

1. Multiplayer
   - El estado de partida vive en backend.
   - El backend captura frames y eventos durante la partida.
   - Al terminar, persiste `MatchReplay` en base de datos.
   - El frontend lista el replay desde `/api/matches/replays/me` y lo reproduce con `ReplayController` + `ReplayScene`.

2. Partidas locales / singleplayer
   - El estado vive en frontend.
   - Cada escena local captura snapshots compatibles con el formato de replay:
     - `KameKnockScene`
     - `BambooBashScene`
     - `BellClashScene`
     - `ShellCurlScene`
   - Al terminar la partida, el frontend hace `POST /api/matches/replays/import`.
   - El backend crea un `Match`, sus `MatchPlayer` y un `MatchReplay` temporal de 3 dias.
   - Ese replay aparece en la misma lista que los multiplayer.

## Archivos Clave

### Frontend

- [frontend/src/games/kame-knock/KameKnockScene.ts](/home/marcos/programming/transgender/frontend/src/games/kame-knock/KameKnockScene.ts)
  - Logica de captura local de replay en singleplayer.
  - Construccion del payload de importacion.
  - Inicio del guardado al terminar la partida.

- [frontend/src/features/hub/api.ts](/home/marcos/programming/transgender/frontend/src/features/hub/api.ts)
  - Cliente REST de replay:
    - `getMyReplays()`
    - `getReplay(matchId)`
    - `importReplay(payload)`
    - `saveReplay(matchId)`
    - `unsaveReplay(matchId)`

- [frontend/src/pages/HomePage.tsx](/home/marcos/programming/transgender/frontend/src/pages/HomePage.tsx)
  - Modal de replays.
  - Carga la lista desde backend.
  - Carga el detalle de un replay concreto.
  - Monta el visor Phaser del replay.

- [frontend/src/games/shared/ReplayController.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayController.ts)
  - Controla playback, pausa, seek, progreso y tiempo del replay.

- [frontend/src/games/shared/ReplayScene.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayScene.ts)
  - Renderiza el replay visualmente.
  - Para `kame-knock`, pinta targets, shell y snapshot frame a frame.

- [frontend/src/services/network/gameSocket.ts](/home/marcos/programming/transgender/frontend/src/services/network/gameSocket.ts)
  - Tipos compartidos de snapshot, incluyendo `KameKnockSnapshot`.

### Backend

- [backend/src/modules/matchmaking/matches.controller.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/matches.controller.ts)
  - Endpoints HTTP:
    - `GET /api/matches/replays/me`
    - `GET /api/matches/:id/replay`
    - `POST /api/matches/replays/import`
    - `POST /api/matches/:id/replay/save`
    - `DELETE /api/matches/:id/replay/save`

- [backend/src/modules/matchmaking/replay.service.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay.service.ts)
  - Servicio principal de replay.
  - Captura frames multiplayer.
  - Persiste replays multiplayer.
  - Lista, carga y guarda replays.
  - Importa replays singleplayer.

- [backend/src/modules/matchmaking/entities/match-replay.entity.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/entities/match-replay.entity.ts)
  - Entidad `match_replays`.
  - Define `MatchReplayFrame` y `MatchReplayEvent`.

- [backend/src/modules/matchmaking/entities/match.entity.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/entities/match.entity.ts)
  - Entidad `matches`.
  - La importacion singleplayer crea aqui un match sintetico `casual`.

- [backend/src/modules/matchmaking/entities/match-player.entity.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/entities/match-player.entity.ts)
  - Entidad `match_players`.
  - Se usa para determinar quien puede ver un replay.

- [backend/src/modules/matchmaking/matchmaking.gateway.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/matchmaking.gateway.ts)
  - En multiplayer, registra eventos y captura estado para replay.

- [backend/src/main.ts](/home/marcos/programming/transgender/backend/src/main.ts)
  - Configuracion HTTP global.
  - Aqui impacta directamente cualquier limite de body para `POST /api/matches/replays/import`.

### Infra / Entorno

- [infra/reverse-proxy/conf/default.conf.template](/home/marcos/programming/transgender/infra/reverse-proxy/conf/default.conf.template)
  - Nginx proxya `/api/` al backend.
  - Tiene `client_max_body_size 10m`.

- [docker-compose.override.yml](/home/marcos/programming/transgender/docker-compose.override.yml)
  - En desarrollo, `frontend` va en hot reload.
  - Ojo: el `backend` que realmente se ejecuta puede no coincidir con la expectativa del Makefile si el flujo de rebuild no se usa bien.

- [Makefile](/home/marcos/programming/transgender/Makefile)
  - `restart-back` solo reinicia contenedor.
  - `rebuild-back` recompila y recrea backend.
  - `refresh-app` ahora debe reconstruir frontend y backend.

## Flujo Detallado De Replays Locales

### 1. Inicio De Captura

En cada escena local:

- si no hay `onlineMatch`, se llama a `initLocalReplayRecording()`
- se inicializa:
  - `localReplayId`
  - `localReplayFrames`
  - `localReplayStartedAtIso`
  - contadores de tiempo

### 2. Captura De Frames

En `update()` de la escena activa:

- se avanza `localReplayElapsedMs`
- se capturan frames locales con `captureLocalReplayFrame()`
- cada frame guarda:
  - `seq`
  - `recordedAt`
  - `deltaMs`
  - `snapshot`

El `snapshot` sale de `buildLocalReplaySnapshot()` y contiene el contrato del juego correspondiente:

- `temple-curling`: estado de ends, piedras, bumpers, score y jugadores
- `bamboo-bash`: score, tiempo, bambus, bolas y jugadores
- `kame-knock`: rounds, targets, score, bola activa y jugadores
- `bell-clash`: zonas, score, disparos, bola y jugadores

### 3. Fin De Partida

En la pantalla final o final de ronda local:

- se fuerza un ultimo frame con fase `finished`
- se llama a `persistLocalReplay()`
- en paralelo se lanza `submitGameResult()`
- luego se muestra la pantalla final

### 4. Importacion Al Backend

En `persistLocalReplay()`:

- si el usuario es `guest`, no hace nada
- construye `ReplayImportRequest`
- hace `api.importReplay(importPayload)`

Ese endpoint es:

- `POST /api/matches/replays/import`

### 5. Persistencia En Backend

En `ReplayService.importSingleplayerReplayForUser()`:

- valida el input
- crea un `Match` sintetico `casual`
- crea `MatchPlayer[]`
- crea `MatchReplay`
- le asigna `expiresAt = now + 72h`

Eso hace que:

- solo el jugador participante pueda verlo
- si no se guarda manualmente, expire a los 3 dias

### 6. Propiedad, Guardado Y Expiracion

Para partidas locales:

- el replay se guarda solo en servidor
- no se usa `localStorage`
- solo se crea si el usuario esta autenticado
- si el usuario es `guest`, `persistLocalReplay()` sale sin importar nada

La persistencia larga depende de:

- `match_replay_saves`
- `saveReplay(matchId)`
- `unsaveReplay(matchId)`

Si nadie lo guarda:

- el replay queda temporal
- `expiresAt` marca su borrado funcional a las 72 horas

## Flujo Detallado De Multiplayer

### 1. Captura En Tiempo Real

El backend usa:

- `ReplayService.captureFrame(room, force?)`
- `ReplayService.recordEvent(room, type, payload)`

Esto se activa desde:

- `MatchmakingGateway`

Especialmente en:

- `emitState(matchId)` para snapshots
- handlers de `release` para eventos de tiro

### 2. Persistencia Final

Cuando la partida termina:

- `GameSessionService` acaba llamando a la persistencia del replay
- `ReplayService.persistReplayForRoom(room)` guarda `match_replays`

### 3. Visibilidad

La visibilidad depende de:

- participacion en `match_players`
- TTL del replay
- saves en `match_replay_saves`

La regla central esta en:

- `ReplayService.canAccessReplay()`

## Como Se Lista Y Reproduce

### Listado

`HomePage.openReplays()` llama:

- `api.getMyReplays()`

Backend responde desde:

- `ReplayService.listForUser(userId)`

### Carga De Un Replay

`HomePage.handleLoadReplay(matchId)` llama:

- `api.getReplay(matchId)`

Backend responde desde:

- `ReplayService.getForUser(matchId, userId)`

### Reproduccion

`HomePage` crea:

- `new ReplayController(selectedReplay)`
- `new Phaser.Game(...)`
- `new ReplayScene()`

`ReplayScene` usa los frames del replay y renderiza:

- arena
- targets
- shell
- score / frame actual

El estado del playback depende de:

- `ReplayController.play()`
- `ReplayController.pause()`
- avance por `tick(deltaMs)`
- frames ya normalizados dentro de `ReplayDetail`

## Fallos Reales Encontrados

### 1. Replay visible que no era singleplayer

Se detecto una replay en BD:

- `kame-knock`
- `status = abandoned`
- `frameCount = 10`
- dos jugadores reales

No era la partida singleplayer actual. Era una replay online rota/antigua.

### 2. El replay singleplayer no aparecia porque no se insertaba nada

Se comprobo que:

- `match_replays` seguia vacia para el flujo singleplayer
- por tanto no era un fallo del listado
- era un fallo de importacion / persistencia

### 3. `413` al importar replay

El `reverse_proxy` registraba:

- `POST /api/matches/replays/import ... 413`

Esto significa:

- el navegador si intentaba subir el replay
- pero la peticion era rechazada por tamano antes de persistir nada

### 4. `restart-back` no bastaba

Se detecto que:

- `restart-back` solo reinicia el contenedor
- no recompila backend
- si el cambio afecta al binario compilado, se seguia ejecutando la version vieja

Por eso, para cambios reales de backend, el target correcto es:

- `make rebuild-back`

### 5. `refresh-app` podia dejar backend viejo

Se corrigio `Makefile` para que:

- `refresh-app` no haga solo `restart-back`
- tambien reconstruya backend

Si no, el frontend podia quedar nuevo pero el endpoint de importacion seguir sirviendo codigo anterior.

## Puntos De Depuracion Rapida

### Ver si el frontend intenta subir el replay

Revisar:

- `KameKnockScene.persistLocalReplay()`
- `KameKnockScene.buildReplayImportFrames()`
- network tab del navegador
- logs del proxy

### Ver el codigo de respuesta real

En Nginx:

- `POST /api/matches/replays/import`

Si da:

- `413`: body demasiado grande
- `403`: CSRF o auth
- `404`: ruta no montada
- `5xx`: fallo backend

### Ver si el backend recibio algo

Mirar:

- logs del backend
- consultas `INSERT INTO matches`
- `INSERT INTO match_players`
- `INSERT INTO match_replays`

### Ver si la replay ya esta en BD

Consultar:

- `match_replays`
- `matches`
- `match_players`
- `match_replay_saves`

### Ver si el replay se podo demasiado

Revisar en `KameKnockScene.ts`:

- `REPLAY_CAPTURE_STEP_MS`
- `MAX_IMPORTED_REPLAY_FRAMES`
- condiciones que deciden si se captura frame automatico o solo forzado

Si esos limites son demasiado agresivos:

- el replay puede existir
- pero con muy pocos frames o sin informacion suficiente para reproducirse bien

## Comandos Recomendados

Para validar cambios de backend de replay:

- `make rebuild-back`

Para validar frontend + backend:

- `make refresh-app`

Para mirar estado:

- `make ps`
- `make logs SERVICE=backend`

## Estado Actual

La arquitectura del replay de `kame-knock` ya esta repartida por las piezas correctas:

- captura local en frontend
- importacion unificada al backend
- listado centralizado por usuario
- visor Phaser reutilizable

El cuello de botella real observado durante la depuracion ha sido:

- tamano del body de importacion
- y confusion entre `restart-back` y `rebuild-back`

## Resumen Practico

Para que un replay de `kame-knock` funcione de extremo a extremo tienen que cumplirse todas estas piezas:

- `KameKnockScene` debe capturar frames utiles
- `persistLocalReplay()` debe dispararse al final
- `POST /api/matches/replays/import` no debe ser rechazado
- `ReplayService.importSingleplayerReplayForUser()` debe insertar `matches`, `match_players` y `match_replays`
- `listForUser()` debe devolver ese replay al mismo usuario
- `ReplayScene` debe saber pintar `targets`, `shell`, jugador y estado frame a frame

## Lecturas Relacionadas

- [docs/replay-recording-checkpoint-2026-07-01.md](/home/marcos/programming/transgender/docs/replay-recording-checkpoint-2026-07-01.md)
- [backend/src/modules/matchmaking/replay.service.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay.service.ts)
- [frontend/src/games/kame-knock/KameKnockScene.ts](/home/marcos/programming/transgender/frontend/src/games/kame-knock/KameKnockScene.ts)
- [frontend/src/games/shared/ReplayScene.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayScene.ts)
- [frontend/src/games/shared/ReplayController.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayController.ts)
