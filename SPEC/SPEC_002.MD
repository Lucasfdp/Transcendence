# SPEC-002 — Board System

Status: APPROVED

Priority: CRITICAL

Depends on:
- SPEC-001 Tournament Runtime

---

# Objetivo

El Board System representa el tablero sobre el que transcurre la partida.

Su única responsabilidad consiste en administrar el estado del tablero y el movimiento de los jugadores.

El Board System no conoce:

- minijuegos
- gambling
- recompensas
- boss
- economía
- matchmaking

El Board únicamente sabe:

- dónde está cada jugador
- cuál es la siguiente casilla
- qué ocurre cuando un jugador pisa una casilla

Todo lo demás pertenece a otros sistemas.

---

# Responsabilidades

El Board System será responsable de:

- almacenar el tablero
- almacenar casillas
- almacenar posición de jugadores
- calcular movimiento
- resolver la casilla alcanzada
- emitir eventos

Nunca modificará directamente:

- puntuaciones
- inventarios
- objetos clave
- recompensas

Siempre emitirá eventos.

---

# Modelo Conceptual

Tournament

↓

Board

↓

Tiles

↓

Tile Actions (SPEC-006)

↓

Board Events

---

# Board

El tablero es una colección ordenada de casillas.

Cada casilla tiene un identificador único.

El tablero deberá ser completamente configurable mediante datos.

No deberá existir ninguna lógica hardcodeada para un tablero concreto.

---

# Restricciones

El Board nunca conocerá nombres artísticos.

Ejemplo:

Incorrecto

Tile 15 = Pirate Shop

Correcto

Tile 15

actions = [OpenShop]

metadata.theme = placeholder

La presentación pertenece al Frontend.

---

# Estructura

Board

id

name

tiles[]

startingTile

configuration

---

# Tile

Cada Tile deberá contener exclusivamente datos.

id

connections

actions[]

metadata

v1: `connections` contiene exactamente UNA conexión de salida (tablero de sucesor único). Las bifurcaciones con elección del jugador son extensión futura (D13, SPEC-040).

Las Tiles no tienen tipo de comportamiento.

Todo comportamiento vive en actions[] (SPEC-006).

metadata puede contener claves de presentación (theme, icono) que el Board nunca interpreta.

---

# Composición de casillas v1

Las casillas iniciales (salida, vacía, bonus, penalización, tienda, robo, evento aleatorio) se definen como combinaciones de Actions en el catálogo de configuración (SPEC-024).

Nunca como tipos con lógica propia.

---

# Movimiento

El movimiento siempre comienza cuando Tournament Runtime lo solicita.

Board nunca inicia movimiento por sí mismo.

Flujo

Player

↓

Roll Dice

↓

Runtime

↓

Board.movePlayer()

↓

Resolver destino

↓

Emitir eventos

↓

Fin

---

# Movimiento paso a paso

Entrada

PlayerID

Steps

BoardState

Proceso

1.

Obtener posición actual.

2.

Calcular recorrido.

3.

Calcular casilla destino.

4.

Actualizar posición.

5.

Resolver Tile.

6.

Emitir resultado.

Salida

Nueva posición.

Eventos generados.

---

# Regla importante

Los jugadores pueden compartir casilla.

No existe colisión.

No existe bloqueo.

No existe prioridad.

Una Tile puede contener cualquier cantidad de jugadores.

---

# Teleports y relocalizaciones forzadas

Cuando un jugador es reubicado sin tirada propia (Teleport o movimiento forzado de un Item o evento aleatorio: TeleportAction, MovePlayerAction), la casilla de destino SIEMPRE se resuelve, igual que si hubiera llegado moviéndose (default provisional, D8 en SPEC-040).

Una relocalización forzada nunca puede encadenar más de una relocalización adicional por resolución de destino: si la casilla de destino vuelve a reubicar al jugador (por Teleport o por movimiento forzado), ese segundo destino se resuelve sin ejecutar nuevas relocalizaciones (límite anti-bucle).

---

# Tile Resolution

Cuando un jugador termina el movimiento

SIEMPRE

se ejecutan las Actions de la Tile mediante el Tile Action Framework (SPEC-006).

Nunca el propio Board.

Board únicamente delega.

Board

↓

Tile Actions (SPEC-006)

↓

Eventos

---

# Ejemplo

Jugador cae en una casilla con OpenShopAction.

Board

↓

OpenShopAction

↓

ShopRequested

↓

ShopSystem

El Board nunca abre una tienda.

---

# Eventos emitidos

PlayerMoved

TileEntered

TileResolved

MovementFinished

(MovementInterrupted fue eliminado de v1: nada lo emitía ni lo consumía — D8, SPEC-040. Catálogo canónico en SPEC-004.)

---

# API pública (comandos)

Siguiendo la regla de comandos/eventos de SPEC-004, las mutaciones del Board con resultado son comandos síncronos, nunca eventos:

initialize(boardConfig)

reset()

movePlayer(playerId, steps) → resultado del movimiento

teleportPlayer(playerId, tileId) → resultado de la relocalización

Consumidores autorizados: Runtime, Turn System y Actions (mediante ActionContext.Services, SPEC-008).

No existe el evento MovePlayer: el movimiento siempre se solicita por comando (ver "Nombres retirados" en SPEC-004).

---

# Board Configuration

Todo el tablero deberá construirse desde configuración.

Nunca mediante código.

Ejemplo

BoardConfig

Tiles

Connections

Special Rules

Theme

Spawn Position

Future Extensions

Esto permitirá crear múltiples tableros sin modificar código.

---

# Future Compatibility

El sistema deberá soportar:

Múltiples mapas.

Eventos temporales.

Tableros estacionales.

Tableros desbloqueables.

Variantes.

Todo utilizando únicamente configuración.

---

# Restricciones Arquitectónicas

El Board nunca conocerá:

Boss

Shell

Leaderboard

Economía

Consumibles

Gambling

Minijuegos

Usuarios

Networking

UI

---

# Networking

El Board nunca enviará paquetes.

Únicamente actualizará estado.

El Runtime decidirá qué sincronizar.

---

# Persistencia

El estado del Board (posiciones de jugadores, estado de casillas) forma parte del snapshot del Tournament que se persiste en Postgres tras cada transición (SPEC-023).

El Board no gestiona esa persistencia: el Runtime serializa su estado.

Al finalizar la partida el estado deja de ser relevante.

---

# Casos límite

Jugador se desconecta

No afecta al Board.

---

Dos jugadores llegan simultáneamente

Ambos ocupan la misma Tile.

---

Tile inexistente

Debe producir error controlado.

Nunca excepción no controlada.

---

Configuración inválida

El Board no debe inicializarse.

---

# Criterios de aceptación

✓ El Board desconoce completamente la economía.

✓ El Board desconoce completamente los minijuegos.

✓ El Board desconoce completamente el Gambling.

✓ El Board únicamente administra posiciones.

✓ Todo el comportamiento de una Tile depende de sus Actions (SPEC-006).

✓ Los jugadores pueden compartir casilla.

✓ El tablero completo puede reemplazarse mediante configuración.
