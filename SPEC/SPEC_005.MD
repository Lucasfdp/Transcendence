# SPEC-005 — Turn System

Status: APPROVED

Priority: CRITICAL

Depends on:

- SPEC-001 Tournament Runtime
- SPEC-002 Board System
- SPEC-003 Tournament State Machine
- SPEC-004 Tournament Event Bus

---

# Objetivo

El Turn System controla el turno individual de cada jugador durante una ronda.

No conoce:

- Minijuegos
- Gambling
- Boss
- Economía global
- Leaderboard
- Objetos clave

Su única responsabilidad consiste en ejecutar correctamente el turno de un jugador.

---

# Filosofía

Un turno es una secuencia cerrada de acciones.

Todos los jugadores ejecutan exactamente un turno por ronda.

No existen turnos extra.

No existen turnos infinitos.

---

# Flujo

Inicio Turno

↓

Activar jugador

↓

Esperar lanzamiento del dado

↓

Calcular movimiento

↓

Mover jugador

↓

Resolver Tile

↓

Esperar resolución completa

↓

Finalizar turno

↓

Siguiente jugador

---

# Estado del Turno

Cada turno mantiene:

PlayerId

Round

CurrentPosition

DiceResult

MovementFinished

TileResolved

TurnFinished

---

# Restricciones

Solo puede existir un turno activo.

Solo un jugador puede interactuar con el tablero.

Todos los demás jugadores permanecen como espectadores.

---

# Inicio del turno

Cuando comienza un turno:

El Turn System emite

PlayerTurnStarted

(este evento es propiedad del Turn System, ver catálogo canónico en SPEC-004)

La UI desbloquea únicamente los controles del jugador activo.

Todos los demás jugadores permanecen bloqueados.

---

# Lanzamiento del dado

El jugador decide cuándo lanzar.

El servidor genera el resultado.

Nunca el cliente.

El resultado es inmutable.

---

# Dados

El Turn System no conoce tipos de dados.

Únicamente solicita:

RollDice

El Dice System decidirá:

Normal

Especial

Consumible

etc.

---

# Movimiento

Una vez obtenido el valor:

Board.movePlayer()

Es un comando síncrono de la API pública del Board (SPEC-002), nunca un evento: no existe el evento MovePlayer (SPEC-004).

El Turn System invoca el comando y espera los eventos del Board (PlayerMoved, TileResolved, MovementFinished).

No calcula rutas.

No mueve jugadores.

---

# Resolución

Cuando el Board termina:

TileResolved

MovementFinished

↓

Turn continúa.

---

# Finalización

Un turno termina únicamente cuando:

Movimiento terminado.

Tile completamente resuelta.

Toda sesión interactiva abierta por la Tile ha finalizado (ver "Ventana de interacción").

No existen eventos pendientes.

---

# Ventana de interacción

Si la resolución de la Tile abre una sesión interactiva (p. ej. una tienda mediante OpenShopAction), el turno entra en el subestado WAITING_INTERACTION (SPEC-003).

El Turn System espera al evento de cierre de la sesión (ShopClosed) antes de finalizar el turno.

El protocolo completo de la sesión de tienda (Open → Waiting → Buy/Cancel/Timeout → Close) se define en SPEC-012.

La ventana tiene timeout propio (v1: 30 segundos, SPEC-024): al expirar, la sesión se cierra sin compra y el turno continúa.

El Gambling NO es una ventana de interacción de turno: es una fase del Runtime (GAMBLING_PHASE, SPEC-001) y nunca ocurre dentro de un turno.

---

# Timeout

Todo turno tiene un timeout configurable.

Valor inicial v1: 30 segundos para lanzar el dado.

Al expirar:

↓

El servidor lanza el dado automáticamente.

↓

El turno se resuelve sin interacciones opcionales (sin compras, sin uso de Items).

↓

El turno finaliza con normalidad.

El timeout nunca expulsa al jugador.

La ventana de interacción tiene su propio timeout independiente (ver "Ventana de interacción").

---

# Desconexión

Si el jugador activo se desconecta:

↓

Su turno se auto-resuelve inmediatamente (tirada automática, sin interacciones opcionales).

↓

La partida continúa.

La política de reconexión y abandono pertenece a SPEC-023.

Nunca debe bloquear la partida.

---

# Eventos emitidos

PlayerTurnStarted

DiceRollRequested

PlayerTurnFinished

(DiceRolled lo emite el Dice System, SPEC-010; PlayerMoved, TileResolved y MovementFinished los emite el Board, SPEC-002. Catálogo canónico en SPEC-004.)

---

# Eventos consumidos

TileResolved

PlayerMoved

MovementFinished

DiceRolled

ShopClosed

---

# Integración

Turn System

↓

Board

↓

Tile Actions (SPEC-006)

↓

Event Bus

↓

Runtime

---

# Restricciones

Nunca modificar puntos.

Nunca modificar objetos.

Nunca iniciar minijuegos.

Nunca iniciar Gambling.

Nunca entregar recompensas.

---

# Casos límite

Jugador pulsa varias veces el dado

↓

Ignorar.

Solo un lanzamiento.

---

Movimiento cancelado

↓

No permitido.

---

Jugador intenta actuar fuera de su turno

↓

Ignorar petición.

Registrar intento.

---

Cliente modificado

↓

Servidor valida absolutamente todo.

---

# Criterios de aceptación

✓ Solo existe un turno activo.

✓ Solo el servidor decide el dado.

✓ Solo el Runtime cambia de jugador.

✓ El Turn System no conoce ninguna otra mecánica.
