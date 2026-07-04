# Plan De Reparacion De Consistencia De Replays

## Objetivo

Este documento define el plan tecnico para estabilizar los replays sin aplicar cambios de codigo todavia. El objetivo es que el replay reproduzca lo que vio el jugador durante la partida, usando snapshots completos como fuente principal y dejando los eventos como informacion complementaria.

El alcance aplica a:

- Temple Curling.
- Kame Knock.
- Bamboo Bash.
- Bell Clash.
- Replays online multiplayer.
- Replays local-versus.
- Replays singleplayer importados.

## Principio Central

`ReplayFrame` debe ser la fuente principal del render.

Cada frame debe contener estado visible suficiente para pintar el replay sin derivar simulacion nueva en el visor. `events` debe quedar limitado a:

- FX no criticos.
- Sonido o marcas de depuracion.
- Compatibilidad con replays antiguos.
- Fallback visual cuando un replay legacy no tenga snapshot suficiente.

La direccion del arreglo no es hacer mas inteligente `ReplayScene`, sino hacer mas estricto y completo el contrato de captura.

## Contrato Unico De Replay

### ReplayFrame

Un `ReplayFrame` debe incluir:

- `seq`: secuencia monotona del estado.
- `recordedAt`: fecha ISO real de captura.
- `recordedAtMs`: timestamp numerico cuando exista en backend.
- `tickTs`: milisegundos desde el inicio del replay.
- `deltaMs`: tiempo real desde el frame anterior.
- `snapshot`: estado visible completo del juego en ese instante.

Reglas:

- `deltaMs` no debe inventarse en frontend.
- `tickTs` y `recordedAtMs` deben ser coherentes con `recordedAt`.
- El ultimo frame debe representar el estado final visible de la partida.
- La reproduccion debe poder hacer seek a cualquier frame sin depender de eventos previos.

### ReplayEvent

Un `ReplayEvent` debe incluir:

- `type`: tipo estable de evento.
- `seq`: secuencia asociada al estado.
- `recordedAt`: fecha ISO real.
- `recordedAtMs`: timestamp numerico cuando exista.
- `tickTs`: milisegundos desde el inicio del replay.
- `payload`: datos especificos del evento.

Reglas:

- No debe ser necesario reproducir eventos anteriores para reconstruir posicion, escala, visibilidad o score.
- Los eventos pueden activar particulas, impactos, sonidos o marcas temporales.
- Los eventos pueden alimentar fallback legacy, pero esa ruta no debe ser el flujo principal.

## Metadata Visual Por Jugador

Cada replay debe poder resolver la identidad visual de cada jugador sin consultar estado externo inestable. La metadata minima por jugador debe ser:

- `side`.
- `userId`.
- `username`.
- `turtleName`.
- `shellSkin`.
- `hubBackground`.
- `hubBackgroundAlter`.

Fallbacks:

- Si falta `hubBackground`, usar `night_bg`.
- Si falta `hubBackgroundAlter`, usar el valor base de `hubBackground`.
- Si falta `shellSkin`, usar la skin por defecto del juego.
- Si falta `turtleName`, usar `username`.

La metadata debe persistirse junto al replay o dentro de snapshots normalizados. No debe depender de que el usuario cambie o no sus cosmeticos despues de la partida.

## Fondo Por Jugador Activo

El fondo del visor debe reflejar el jugador activo en cada momento.

Regla de resolucion:

1. Leer `currentTurn` si existe.
2. Si no existe, resolver desde `activeStoneId` y la entidad/stone correspondiente.
3. Si no existe, resolver desde `activeBallIdBySide` o campo equivalente.
4. Si no existe, resolver desde estado especifico del juego que identifique turno o atacante.
5. Si no se puede resolver, mantener el ultimo jugador activo conocido.
6. Si no hay jugador activo previo, usar `side = 0`.

Cuando el jugador activo cambia, `ReplayScene` debe cambiar el fondo al `hubBackground` o `hubBackgroundAlter` equipado por ese jugador. Si el replay no contiene metadata visual suficiente, debe caer a `night_bg`.

Esta regla aplica a todos los juegos, incluso cuando el estado visual principal sea una arena comun.

## Snapshots Estandarizados Por Juego

Todos los snapshots deben compartir una base comun:

- `gameId`.
- `seq`.
- `phase` o estado equivalente.
- `players`.
- `scores`.
- `currentTurn` o equivalente.
- `entities`.
- `powerups` o pickups visibles cuando correspondan.
- `ended`, `winnerSide` y estado final equivalente.

### Entidades

`entities` debe ser la fuente canonica para actores renderizables. Cada entidad debe incluir, cuando aplique:

- `id`.
- `type`.
- `side`.
- `x`.
- `y`.
- `vx`.
- `vy`.
- `rotation`.
- `angularVelocity`.
- `r` o dimensiones equivalentes.
- `power`.
- `scale`.
- `stateFlags`.
- `visible`.
- `alpha`.
- `spriteKey`.
- `trail`.

Reglas:

- `balls` puede mantenerse por compatibilidad, pero debe ser mirror o derivable de `entities`.
- `objects` puede mantenerse en curling para bumpers, stones u obstaculos propios, pero no debe sustituir actores principales si `entities` los representa mejor.
- Las entidades invisibles deben persistir con `visible: false` cuando su ausencia sea temporal y relevante para interpolacion o seek.

### Temple Curling

El snapshot debe incluir:

- Stones completas con posicion, velocidad, radio, side, estado activo y power aplicado.
- `objects` para bumpers y obstaculos de pista.
- `currentTurn` o stone activa.
- Score y estado final.
- Trails si son visibles.

### Kame Knock

El snapshot debe incluir:

- Proyectiles/shells como entidades completas.
- Targets con `id`, tipo, posicion, vida/estado, visibilidad, escala y sprite.
- Powerups activos y pickups visibles.
- `currentTurn` o atacante activo.
- Score, combo o progreso equivalente si se muestra al jugador.

### Bamboo Bash

El snapshot debe incluir:

- Bamboos con etapa, posicion, escala, visibilidad y sprite.
- Shells/balls como entidades completas.
- Powerups activos y pickups visibles.
- Jugador activo.
- Score y estado final.

### Bell Clash

El snapshot debe incluir:

- Balls como entidades completas.
- Zonas/campanas con estado visual completo.
- Powerups activos y pickups visibles.
- Jugador activo o atacante.
- Score, control de zonas y estado final.

## Powerups

Los powerups deben verse porque el snapshot ya trae el resultado aplicado. El replay no debe recalcular efectos de gameplay.

Efectos visibles que deben quedar capturados:

- `rocket`: velocidad, direccion, trail o FX visible.
- `giant`: escala/radio aumentado.
- `tiny`: escala/radio reducido.
- `spinning`: rotacion o estado de giro.
- `ghost`/`phantom`: alpha, visibilidad y estado intangible si se muestra.
- `splitter`: entidades hijas resultantes y relacion con la entidad original si hace falta.
- `mirror`: direccion/estado invertido ya aplicado.
- Trails persistentes.
- Pickups visibles antes de ser recogidos.
- Estado de power equipado, consumido o activo si se muestra en UI.

La regla practica es: si el jugador pudo verlo o afecto a lo que vio, debe estar en `snapshot`.

## Captura Y Playback Base

### Captura

La captura debe ocurrir en puntos donde el estado visible ya este actualizado:

- inicio de partida,
- inicio de turno,
- lanzamiento o accion principal,
- ticks relevantes durante movimiento,
- aplicacion de powerup,
- cambios de score,
- destruccion o aparicion de entidades,
- final de turno,
- final de partida.

La frecuencia debe ser suficiente para interpolar movimiento sin depender de simulacion nueva. Si el servidor emite estado con poca frecuencia, la captura debe enriquecerse o separarse de esa cadencia.

### Playback

`ReplayController` debe:

- respetar `deltaMs`, `tickTs` o tiempos grabados;
- permitir seek determinista por frame;
- no comprimir ni expandir artificialmente la duracion total;
- exponer frame actual, siguiente frame y progreso de interpolacion.

`ReplayScene` debe:

- renderizar desde snapshot como ruta principal;
- interpolar solo entre datos ya capturados;
- evitar simulacion derivada para entidades modernas;
- mantener fallback por eventos solo para replays antiguos.

## Compatibilidad Online, Local-Versus Y Singleplayer Importado

El contrato debe ser unico para todos los origenes:

- Multiplayer online persistido al terminar una partida.
- Local-versus generado en cliente.
- Singleplayer importado por API.

La importacion singleplayer debe normalizar o rechazar replays que no cumplan el contrato minimo. La validacion actual no debe quedarse solo en juego soportado, estado y numero de frames.

Validaciones futuras:

- `frames` no vacio y dentro de limite.
- `seq` monotono.
- tiempos validos y no negativos.
- `snapshot.gameId` coherente con `gameId`.
- `players` presentes y lados coherentes.
- presencia de `entities` o equivalente requerido por juego.
- score y final de partida coherentes con `status` y `winnerSide`.
- metadata visual de jugadores normalizada con fallbacks.

Si un replay importado es legacy, debe marcarse como tal o transformarse a un snapshot normalizado antes de persistirlo.

## Fases De Implementacion

### Fase 1. Contrato Y Tipos

Estado: aplicada el 2026-07-04 como primera version compatible del contrato.

- Definir tipos compartidos mas estrictos para `ReplayFrame`, `ReplayEvent`, jugador de replay y entidades.
- Documentar campos obligatorios por juego.
- Introducir version de contrato, por ejemplo `replayVersion`.
- Mantener compatibilidad de lectura para replays antiguos.

Checkpoint:

- [docs/replay-contract-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-contract-checkpoint-2026-07-04.md)

### Fase 2. Metadata Visual Y Fondo Activo

Estado: aplicada el 2026-07-04.

- Persistir metadata visual por jugador en replays nuevos.
- Implementar resolucion de jugador activo por frame.
- Cambiar el fondo del visor cuando cambie el jugador activo.
- Usar `night_bg` como fallback.

Checkpoint:

- [docs/replay-visual-metadata-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-visual-metadata-checkpoint-2026-07-04.md)

### Fase 3. Snapshots Completos

Estado: aplicada el 2026-07-04 como normalizacion inicial de mirrors `entities` para replay.

- Normalizar snapshots online para los cuatro juegos.
- Normalizar snapshots local-versus y singleplayer.
- Asegurar `entities`, `balls` mirror cuando aplique, `objects`, trails, powers y estado final.

Checkpoint:

- [docs/replay-snapshot-contract-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-snapshot-contract-checkpoint-2026-07-04.md)

### Fase 4. Powerups

Estado: aplicada el 2026-07-04 como captura visual inicial de powerups en `entities`.

- Auditar cada powerup contra su efecto visible.
- Guardar resultado aplicado en snapshot.
- Evitar que el replay tenga que recalcular fisica o reglas de powerups.

Checkpoint:

- [docs/replay-powerups-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-powerups-checkpoint-2026-07-04.md)

### Fase 5. Playback Principal Desde Snapshot

Estado: aplicada el 2026-07-04.

- Reducir gradualmente `simulateReplayProjectile` y rutas derivadas de `ReplayScene`.
- Mantener fallback por eventos solo cuando el snapshot no tenga datos suficientes.
- Hacer que seek y reproduccion normal usen la misma fuente de verdad.

Checkpoint:

- [docs/replay-snapshot-playback-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-snapshot-playback-checkpoint-2026-07-04.md)

### Fase 6. Importacion Estricta

Estado: aplicada el 2026-07-04 como validacion estricta inicial del contrato v1 en imports.

- Validar imports singleplayer contra el mismo contrato que multiplayer.
- Normalizar campos legacy cuando sea razonable.
- Rechazar replays incompletos con errores claros.

Checkpoint:

- [docs/replay-import-validation-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-import-validation-checkpoint-2026-07-04.md)

### Fase 7. Validacion

Estado: aplicada el 2026-07-04 como cobertura automatizada inicial y matriz manual documentada.

- Verificar matriz manual por juego y modo.
- Anadir pruebas unitarias de contrato, normalizacion y fondo activo.
- Anadir fixtures de replay por juego para evitar regresiones.

Checkpoint:

- [docs/replay-validation-checkpoint-2026-07-04.md](/home/marcos/programming/transgender/docs/replay-validation-checkpoint-2026-07-04.md)

## Plan De Pruebas

### Matriz Manual

Validar cada juego en cada modo:

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

Comprobar en cada caso:

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

### Pruebas Unitarias Cubiertas

- `ReplayController`: duracion, avance, pausa, seek y final de timeline.
- Normalizacion local de snapshots/imports.
- Normalizacion de imports singleplayer.
- Validacion estricta de `ReplayImportRequest`.
- Resolucion de jugador activo desde `currentTurn`, `activeStoneId`, `activeBallIdBySide` y fallback.
- Resolucion de fondo con metadata completa e incompleta.

### Pruebas Futuras Recomendadas

- Fixtures persistidos completos por juego con snapshots largos.
- Validacion semantica profunda de entidad, rangos de arena y `spriteKey`.
- Cobertura end-to-end de la matriz manual en navegador.

## Riesgos

- Replays antiguos pueden carecer de datos suficientes para fidelidad total.
- Capturar demasiados frames puede aumentar almacenamiento y trafico.
- Si cada juego define su propio snapshot sin base comun, la divergencia seguira.
- Validacion estricta puede rechazar imports antiguos si no hay migracion o normalizacion.

## Criterio De Finalizacion

La reparacion se considerara completa cuando:

- los cuatro juegos produzcan snapshots autosuficientes;
- online, local-versus y singleplayer importado usen el mismo contrato;
- el fondo cambie segun jugador activo;
- los powerups visibles se reproduzcan desde snapshot;
- `ReplayScene` use eventos solo como complemento o fallback legacy;
- la matriz manual pase para los cuatro juegos y tres modos;
- existan pruebas unitarias de controlador, normalizacion, importacion y resolucion visual.
