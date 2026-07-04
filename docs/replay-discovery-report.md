# Reporte Vivo De Replays

## Objetivo

Este documento centraliza lo que se va descubriendo sobre el sistema de replays mientras se arregla. No sustituye a los planes previos, sino que los aterriza contra el codigo real y deja registro de:

- como funciona hoy,
- que problemas estan confirmados,
- que decisiones tecnicas se van tomando,
- que partes siguen abiertas.

Se ira actualizando durante el trabajo.

## Documentos Base Revisados

- [docs/replay-fix-plan.md](/home/marcos/programming/transgender/docs/replay-fix-plan.md)
- [docs/replay-recording-checkpoint-2026-07-01.md](/home/marcos/programming/transgender/docs/replay-recording-checkpoint-2026-07-01.md)
- [docs/modules-progress.md](/home/marcos/programming/transgender/docs/modules-progress.md)
- [docs/replay-consistency-repair-plan.md](/home/marcos/programming/transgender/docs/replay-consistency-repair-plan.md)

## Mapa Actual Del Sistema

### Backend

- [backend/src/modules/matchmaking/replay.service.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay.service.ts)
  - Captura frames y eventos de replay en memoria durante la partida.
  - Persiste el replay al terminar.
  - Expone listado, detalle, guardado y desguardado de replays.
- [backend/src/modules/matchmaking/matchmaking.gateway.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/matchmaking.gateway.ts)
  - Registra eventos de juego que luego forman parte del replay.
  - Llama a la captura de frames durante la emision de estado.
- [backend/src/modules/matchmaking/replay-state.helpers.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay-state.helpers.ts)
  - Intenta mantener o simular estado suficiente para mejorar la reconstruccion del replay.
- [backend/src/modules/matchmaking/matches.controller.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/matches.controller.ts)
  - API REST de replays para frontend.
- [backend/src/modules/matchmaking/entities/match-replay.entity.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/entities/match-replay.entity.ts)
  - Entidad persistida con `frames`, `events`, expiracion y metadata asociada.

### Frontend

- [frontend/src/features/hub/api.ts](/home/marcos/programming/transgender/frontend/src/features/hub/api.ts)
  - Tipos `ReplaySummary`, `ReplayDetail`, `ReplayFrame`, `ReplayEvent` y endpoints del hub.
- [frontend/src/pages/HomePage.tsx](/home/marcos/programming/transgender/frontend/src/pages/HomePage.tsx)
  - Lista replays, carga detalle y monta el visor.
- [frontend/src/games/shared/ReplayController.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayController.ts)
  - Controla play, pause, seek, frame index, progreso y tiempo de reproduccion.
- [frontend/src/games/shared/ReplayScene.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayScene.ts)
  - Renderiza el replay con Phaser a partir del frame actual y la timeline del controlador.
- `frontend/src/games/*`
  - Varios minijuegos generan replays locales para singleplayer y luego los importan por API.

## Descubrimientos Confirmados

### 1. El sistema ya no es solo un visor, es una cadena completa

Los replays no son un feature aislado del hub. Atraviesan:

- captura en runtime,
- acumulacion de frames y eventos,
- persistencia en base de datos,
- API de consulta,
- importacion de replays locales,
- reproduccion en Phaser.

Esto implica que los cambios globales deben cuidar compatibilidad entre backend, tipos compartidos y visor.

### 2. El backend guarda dos timelines distintas

En backend existen:

- `replayFrames`: snapshots del estado,
- `replayEvents`: eventos discretos como tiros o acciones relevantes.

Aprendizaje:

- el sistema actual mezcla ambos modelos,
- pero el propio checkpoint ya apunta a que los eventos no deberian ser la fuente principal del render,
- el render exacto depende de que `frames` carguen por si solos el estado visible suficiente.

### 3. La captura de frames depende fuertemente de la emision de estado

La captura actual pasa por `ReplayService.captureFrame(room)` y hoy cuelga de la emision del estado del room.

Aprendizaje:

- si la emision no representa bien el tiempo real o no ocurre con frecuencia suficiente, el replay nace incompleto,
- esto hace que muchos defectos del visor en realidad sean defectos de grabacion.

### 4. El frontend ya usa Phaser para replay

El sistema viejo en SVG ya fue sustituido. Hoy el replay viewer real depende de:

- `ReplayController`,
- `ReplayScene`,
- montaje desde `HomePage.tsx`.

Aprendizaje:

- los arreglos globales ya no pasan por rehacer el viewer desde cero,
- pasan por corregir el contrato entre timeline grabada, controlador y escena.
- aun asi, `ReplayScene` mezcla snapshots con fallback por eventos y simulacion derivada cuando faltan datos.

### 5. Hay dos flujos de origen de replay

Se identifican al menos estos caminos:

- replay online/multiplayer persistido al terminar una partida real,
- replay local/singleplayer importado por `POST /matches/replays/import`.

Aprendizaje:

- cualquier cambio global en schema o validacion de frames debe contemplar ambos caminos,
- si solo arreglamos el multiplayer, los replays importados pueden quedar rotos o inconsistentes.

### 6. Los snapshots online y locales no tienen todavia un contrato unico

Los tipos publicos de frontend aceptan `snapshot: Record<string, unknown>` y la importacion singleplayer persiste los `frames` recibidos tras una validacion minima.

Aprendizaje:

- el sistema permite que cada origen envie formas distintas de snapshot,
- esto explica que un replay pueda funcionar en multiplayer y fallar o verse distinto al importarse desde singleplayer/local,
- la reparacion debe definir un contrato comun antes de ajustar detalles por juego.

### 7. La identidad visual del jugador no esta garantizada en el replay

El modelo de usuario ya contiene cosmeticos como `hubBackground`, `hubBackgroundAlter`, `shellSkin` y `turtleName`, pero el contrato de replay no garantiza que esos datos queden persistidos por jugador en la timeline.

Aprendizaje:

- el visor no puede reconstruir de forma fiable el fondo equipado por jugador solo con los frames actuales,
- `SnapshotPlayer` o su equivalente debe incluir metadata visual suficiente,
- el fondo del replay debe resolverse desde el jugador activo de cada frame con fallback estable.

### 8. Los powerups existen en runtime, pero su fidelidad visual depende del snapshot

`ReplayScene` ya lee campos como `power`, trails y entidades, pero si el snapshot no trae todos los efectos visibles aplicados, el visor acaba simulando, omitiendo o aproximando.

Aprendizaje:

- tamano, velocidad, trails, ghost/phantom, splitter, mirror, rocket, giant, tiny, spinning y pickups visibles deben llegar ya representados en snapshot,
- el replay no debe recalcular reglas de powerups para reproducir lo visto.

## Problemas Confirmados A Dia De Hoy

### Problema 1. El replay actual sigue siendo una reconstruccion parcial

Aunque se enriquecio la implementacion, sigue existiendo dependencia de:

- eventos discretos,
- helpers de simulacion,
- inferencias en frontend.

Consecuencia:

- lo que se reproduce puede divergir de lo que realmente vio el jugador durante la partida.

### Problema 2. El tiempo de reproduccion es una pieza critica y sospechosa

La documentacion previa ya marca que `ReplayController` altera duraciones reales con logica artificial.

Consecuencia:

- aunque el estado fuera correcto, el ritmo del replay puede no coincidir con la partida original.

### Problema 3. La fidelidad real depende mas del schema de frame que del renderer

El hallazgo mas importante hasta ahora es este:

- si el snapshot no contiene el estado visible completo, el renderer siempre va a tener que inventar algo.

Consecuencia:

- no tiene sentido afinar solo la visualizacion si antes no se corrige la densidad y calidad del frame grabado.

### Problema 4. Hay riesgo de divergencia entre juegos

Los minijuegos no necesariamente exponen el mismo nivel de detalle en snapshots y eventos.

Consecuencia:

- el sistema de replay puede comportarse bien en un juego y mal en otro,
- por eso conviene hacer primero cambios globales en contrato, captura y playback base.

### Problema 5. Los fondos por jugador activo no estan persistidos ni resueltos

El replay no garantiza metadata visual por jugador ni una regla comun para cambiar de fondo segun el turno o actor activo.

Consecuencia:

- el visor puede mostrar un fondo generico aunque durante la partida el jugador tuviera otro equipado,
- no hay forma robusta de reconstruir cambios de fondo por `currentTurn`, `activeStoneId`, `activeBallIdBySide` o estado equivalente.

### Problema 6. Los replays importados pasan una validacion demasiado minima

La importacion actual valida juego soportado, estado, existencia de frames y limite maximo, pero no valida contrato visual completo.

Consecuencia:

- un replay singleplayer importado puede no cumplir el mismo contrato que uno multiplayer,
- pueden persistirse snapshots incompletos, tiempos inconsistentes o entidades insuficientes para playback fiel.

### Problema 7. Los powerups no tienen garantizada su representacion final

Aunque los powerups se aplican durante la partida, el replay no garantiza capturar todos sus efectos visibles como estado ya aplicado.

Consecuencia:

- algunos efectos pueden verse distintos, desaparecer al hacer seek o depender de simulacion fallback.

## Hipotesis De Trabajo

Estas hipotesis guiaran los siguientes arreglos mientras no aparezca evidencia contraria:

1. El frame de replay debe ser autosuficiente para renderizar el estado visible principal.
2. Los eventos deben quedar como complemento para FX, depuracion o metadata temporal.
3. `ReplayController` debe respetar el tiempo grabado, no inventar uno nuevo.
4. La solucion global debe servir tanto para replays persistidos desde matchmaking como para replays importados desde juegos locales.

## Implicaciones Para Los Cambios Globales

Antes de entrar en arreglos por minijuego, tiene sentido priorizar:

1. Revisar y estabilizar el contrato de `ReplayFrame` y `ReplayEvent`.
2. Revisar como se calcula `deltaMs`, `tickTs`, `recordedAt` y el progreso total.
3. Confirmar si `ReplayController` reproduce por tiempo real o por avance artificial entre indices.
4. Confirmar que `ReplayScene` renderiza desde snapshot como fuente principal y no desde reconstruccion derivada.
5. Verificar que el flujo `importReplay` soporta el mismo contrato que el flujo multiplayer.
6. Persistir metadata visual por jugador para resolver fondo, skin y nombre sin depender del perfil actual.
7. Validar que los powerups visibles queden expresados en snapshot, no derivados por el visor.

## Plan Tecnico De Reparacion

El plan detallado queda centralizado en [docs/replay-consistency-repair-plan.md](/home/marcos/programming/transgender/docs/replay-consistency-repair-plan.md).

Resumen de decisiones:

- `ReplayFrame` sera la fuente principal de render.
- `events` quedara para FX, depuracion y fallback legacy.
- El fondo debe resolverse por jugador activo en cada frame.
- La metadata visual minima por jugador debe incluir `hubBackground`, `hubBackgroundAlter`, `shellSkin` y `turtleName`, con fallback `night_bg`.
- Los cuatro juegos deben normalizar `entities`, `balls` como compatibilidad o mirror, `objects` en curling, trails, `power`, `scale`, `stateFlags`, `visible`, `alpha` y `spriteKey`.
- Los imports singleplayer deben producir o cumplir el mismo contrato que multiplayer.

## Bitacora De Descubrimientos

### 2026-07-04

- Se confirma que el sistema de replay cruza backend, frontend, persistencia y API; no es un problema local del visor.
- Se confirma la existencia de dos timelines persistidas: `frames` y `events`.
- Se confirma que la captura de frames depende del flujo de emision de estado del room.
- Se confirma que el visor actual productivo usa Phaser mediante `ReplayController` y `ReplayScene`.
- Se confirma que hay dos origenes funcionales de replay: multiplayer persistido e importacion de singleplayer.
- Se fija este documento como reporte vivo para continuar refinandolo conforme avancemos.
- Se confirma que `ReplayScene` usa snapshots, pero mantiene fallback por eventos y simulacion derivada para cubrir lagunas.
- Se confirma que los snapshots online/locales no estan formalmente unificados.
- Se confirma que la importacion de replays singleplayer valida solo requisitos minimos y puede persistir timelines que no cumplan el mismo contrato visual que multiplayer.
- Se documenta la necesidad de persistir metadata visual por jugador y resolver el fondo por jugador activo.
- Se crea el plan tecnico de reparacion en `docs/replay-consistency-repair-plan.md`.
- Se aplica la fase 1 del plan: contrato v1 compatible, tipos base de replay mas estrictos y normalizacion inicial de imports.
- Se crea el checkpoint de fase 1 en `docs/replay-contract-checkpoint-2026-07-04.md`.
- Se aplica la fase 2 del plan: metadata visual por jugador en snapshots online/locales y fondo activo en `ReplayScene`.
- Se crea el checkpoint de fase 2 en `docs/replay-visual-metadata-checkpoint-2026-07-04.md`.
- Se aplica la fase 3 del plan: `entities` queda poblado como mirror canonico en curling y en replays locales de Bamboo Bash, Kame Knock y Bell Clash.
- Se crea el checkpoint de fase 3 en `docs/replay-snapshot-contract-checkpoint-2026-07-04.md`.
- Se aplica la fase 4 del plan: powerups visibles quedan reflejados en `entities` mediante `power`, `scale`, `alpha` y `stateFlags`.
- Se crea el checkpoint de fase 4 en `docs/replay-powerups-checkpoint-2026-07-04.md`.
- Se aplica la fase 6 del plan: los imports singleplayer/local se normalizan una sola vez y se validan contra el contrato v1 antes de persistir.
- Se crea el checkpoint de fase 6 en `docs/replay-import-validation-checkpoint-2026-07-04.md`.
- Se aplica la fase 5 del plan: `ReplayScene` usa `entities` como ruta principal y limita la simulacion por eventos a frames legacy.
- Se crea el checkpoint de fase 5 en `docs/replay-snapshot-playback-checkpoint-2026-07-04.md`.
- Se aplica la fase 7 del plan: se anaden pruebas automatizadas de `ReplayController`, normalizacion local, validacion de imports y resolucion visual de fondo activo.
- Se extrae la resolucion de jugador/fondo activo a `frontend/src/games/shared/replayVisuals.ts` para evitar tests acoplados a Phaser.
- Se crea el checkpoint de fase 7 en `docs/replay-validation-checkpoint-2026-07-04.md`.

## Preguntas Abiertas

- Que campos exactos estan llegando hoy en `frames` por cada minijuego y cuales siguen faltando para reproducir el estado visible completo.
- Que parte del error temporal proviene del backend y cual del `ReplayController`.
- Hasta que punto `replay-state.helpers.ts` corrige lagunas reales del snapshot y hasta que punto introduce nueva divergencia.
- Si conviene mantener compatibilidad hacia atras con replays ya persistidos o migrar el formato.
- Donde debe vivir exactamente la metadata visual persistida: metadata de replay, `players` dentro de snapshot o ambos.
- Que version de contrato conviene introducir para distinguir replays nuevos de legacy.

## Siguiente Actualizacion Prevista

La siguiente mejora de este reporte deberia incluir:

- matriz manual completa por juego y modo,
- fixtures persistidos completos por juego,
- validacion semantica profunda de entidades y assets permitidos.
