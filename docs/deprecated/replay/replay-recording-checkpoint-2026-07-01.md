# Checkpoint Replay Exacto - 2026-07-01

## Objetivo

Convertir el replay actual en una reproduccion fiel de la partida, con tiempo real y persistencia de todas las tiradas visibles, de forma que se comporte como una grabacion y no como una reconstruccion aproximada.

## Estado Actual

Ya hay una primera iteracion implementada sobre el plan de [docs/replay-fix-plan.md](/home/marcos/programming/transgender/docs/replay-fix-plan.md):

- Backend:
  - Se anadio `BallSnapshotData` y se enriquecieron snapshots de arena con `balls[]`.
  - Los eventos de tiro ahora guardan `x`, `y`, `vx`, `vy`.
  - Se creo `backend/src/modules/matchmaking/replay-state.helpers.ts` para simular y sincronizar estado de replay en servidor.
  - Se introdujo emision periodica aproximada para capturar mas frames durante la partida.
- Frontend:
  - Se sustituyo el visor SVG por un visor Phaser.
  - Se creo `ReplayController` para playback, seek y progreso.
  - Se creo `ReplayScene` para renderizar replays de los 4 minijuegos.
  - Se extrajeron utilidades de fisica compartida para reproyectar trayectorias.

## Problemas Confirmados

El sistema actual mejora la version anterior, pero todavia no cumple el requisito de "replica exacta":

1. El replay va demasiado rapido.
   - `ReplayController` altera la duracion real entre frames con un clamp artificial.
   - Resultado: el tiempo de reproduccion no coincide con el tiempo real de la partida.

2. No se mantienen las tiradas anteriores.
   - `ReplayScene` reconstruye proyectiles a partir del ultimo evento relevante por lado.
   - Resultado: visualmente solo sobrevive la ultima tirada y desaparecen las anteriores.

3. El replay sigue siendo una reconstruccion, no una grabacion.
   - Se intenta simular la trayectoria a partir de eventos de release y algunos snapshots.
   - Resultado: cualquier diferencia entre simulacion, red, frame-rate o estado visual hace que el replay diverja del partido real.

4. Faltan datos persistidos para reproducir toda la escena visible.
   - Hoy se guardan partes del estado, pero no todo lo necesario para rehacer exactamente cada frame que vio el jugador.

## Diagnostico

Para que el replay sea exacto hay que dejar de depender de "reconstruir desde inputs" como estrategia principal.

La via practica para este proyecto es:

- Guardar snapshots densos del mundo visible durante la partida.
- Conservar el tiempo real exacto entre snapshots.
- Reproducir esos snapshots tal cual en cliente.
- Usar eventos solo como apoyo para FX, HUD o depuracion, no como base principal del movimiento.

La alternativa de replay determinista puro desde inputs exigiría:

- simulacion totalmente autoritativa en servidor,
- fisica determinista compartida,
- RNG sincronizado,
- mismos assets y mismas reglas de update entre runtime y replay.

Ese no es el estado actual del proyecto, asi que no es la opcion recomendada ahora.

## Datos Que Hay Que Almacenar

### 1. Cabecera del replay

Guardar una vez por replay:

- `matchId`
- `game`
- `createdAt`
- version de build o schema del replay
- configuracion relevante de la partida
- jugadores y lados
- metadata visual necesaria si afecta al render

### 2. Timeline real

Cada frame debe guardar tiempo real, no una duracion inventada:

- `seq`
- `recordedAt` o `tickTs`
- `deltaMs` real respecto al frame anterior

El frontend debe reproducir usando estos tiempos exactos.

### 3. Estado global por frame

Cada frame debe incluir todo el estado jugable visible:

- score por jugador
- ronda, turno, end o fase
- jugador activo
- temporizadores visibles
- flags de fin de partida, countdown, overtime o similar

### 4. Estado completo de entidades visibles

Cada entidad visible debe poder re-renderizarse sin inferencias:

- `id`
- `type`
- `ownerSide`
- `x`, `y`
- `vx`, `vy`
- `rotation`
- `angularVelocity` si aplica
- `scale`
- `visible`
- `alpha`
- `spriteKey` o variante visual
- `stateFlags`

### 5. Estado transitorio de mecanicas

Hay que almacenar tambien lo que modifica comportamiento o visual:

- congelado, fantasma, bomba, splitter, sweep, etc.
- cooldowns y duraciones restantes
- multiplicadores de velocidad, friccion, radio o curl
- cualquier flag temporal que altere fisica o render

### 6. Eventos visuales efimeros

Si se quiere que el replay se vea como el partido real, hay que grabar tambien los FX que no viven en el estado base:

- impactos
- pulsos
- highlights
- trails, si no se derivan exactamente del snapshot
- textos flotantes
- overlays de victoria o countdown

Esto puede guardarse como eventos ligeros con timestamp.

## Datos Minimos Por Minijuego

### Kame Knock

- bola actual y cualquier bola historica que siga visible
- `x`, `y`, `vx`, `vy`, estado de movimiento
- estado completo de objetivos
- combo y score visibles
- flags de power-ups
- eventos de impacto y freeze si afectan al render

### Bamboo Bash

- todas las bolas visibles con estado completo
- bambus completos: posicion, stage, vida visual, timers si aplican
- score y tiempo restante reales
- spawns, destrucciones e impactos visibles

### Bell Clash

- todas las bolas visibles con estado completo
- campana y su pulso/animacion
- zonas activas y cualquier variacion temporal
- score del round
- eventos exactos de hit, zona y multiplicador

### Temple Curling

- todas las piedras visibles en todo momento
- `x`, `y`, `vx`, `vy`, rotacion, movimiento, stopped
- `activeStoneId`
- estado del turno
- sweep/curl si altera la visualizacion
- pickups o elementos del tablero
- trails o eventos necesarios para reconstruirlos exactamente

## Trabajo Pendiente

### Prioridad 1: Corregir el modelo mental del replay

- Dejar de basar el render principal en "ultimo release por lado".
- Reproducir una lista persistente de entidades visibles por frame.
- Hacer que las tiradas anteriores permanezcan si seguian visibles en la partida real.

### Prioridad 2: Tiempo real exacto

- Eliminar clamping artificial de duraciones en `ReplayController`.
- Reproducir usando `deltaMs` o timestamps reales almacenados.
- Ajustar seek, pause y progreso al tiempo real del replay.

### Prioridad 3: Snapshot completo del mundo

- Definir un schema estable de `ReplayFrameSnapshot`.
- Capturar snapshots densos durante la partida con suficiente frecuencia.
- Persistir todas las entidades visibles y su estado completo.

### Prioridad 4: Separar snapshot de FX

- Usar snapshots como fuente de verdad para geometria y estado.
- Usar eventos solo para animaciones efimeras, HUD y efectos.

### Prioridad 5: Verificacion

- Comparar una partida real y su replay en los 4 minijuegos.
- Validar:
  - misma duracion total,
  - mismas posiciones visibles,
  - mismas entidades supervivientes,
  - mismo orden de eventos,
  - mismo resultado final.

## Propuesta De Implementacion Inmediata

1. Definir tipos nuevos de replay en backend para snapshots completos por juego.
2. Cambiar la captura para almacenar entidades visibles completas en cada frame.
3. Cambiar `ReplayScene` para renderizar directamente desde snapshots, sin reconstruccion principal por eventos.
4. Simplificar `ReplayController` para seguir solo tiempo real grabado.
5. Dejar la simulacion derivada por eventos como fallback temporal o eliminarla si deja de ser necesaria.

## Archivos Relevantes

- [docs/replay-fix-plan.md](/home/marcos/programming/transgender/docs/replay-fix-plan.md)
- [backend/src/modules/matchmaking/replay.service.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay.service.ts)
- [backend/src/modules/matchmaking/replay-state.helpers.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/replay-state.helpers.ts)
- [backend/src/modules/matchmaking/matchmaking.gateway.ts](/home/marcos/programming/transgender/backend/src/modules/matchmaking/matchmaking.gateway.ts)
- [frontend/src/games/shared/ReplayController.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayController.ts)
- [frontend/src/games/shared/ReplayScene.ts](/home/marcos/programming/transgender/frontend/src/games/shared/ReplayScene.ts)
- [frontend/src/shared/mechanics/physics.ts](/home/marcos/programming/transgender/frontend/src/shared/mechanics/physics.ts)

## Decision

El siguiente paso correcto no es seguir afinando la reproyeccion de trayectorias, sino rediseñar el formato de replay para que persista el estado visible completo de la partida y reproducirlo con tiempo real exacto.
