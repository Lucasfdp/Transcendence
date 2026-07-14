# SPEC-018 — Leaderboard System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-004 Event Bus
- SPEC-011 Economy System

---

# Objetivo

El Leaderboard System mantiene la clasificación en tiempo real de todos los jugadores durante la partida.

Su única responsabilidad consiste en ordenar correctamente a los jugadores según las reglas del Tournament.

No calcula puntuaciones.

No modifica puntuaciones.

No otorga recompensas.

---

# Filosofía

El Leaderboard es una vista del estado de la partida.

Nunca es la fuente de la verdad.

La fuente de la verdad siempre es el Economy System.

---

# Responsabilidades

- Mantener la clasificación.
- Reordenar jugadores.
- Resolver empates.
- Emitir cambios de posición.
- Sincronizar el estado con todos los clientes.

---

# Arquitectura

Economy System

↓

Event Bus

↓

Leaderboard System

↓

UI

---

# Fuente de datos

El Leaderboard es una proyección derivada: una vista, nunca fuente de verdad.

Escucha exclusivamente WalletUpdated (SPEC-011), que se emite tras cada operación aplicada (Award, Remove, Transfer — incluidos los robos) e incluye el saldo resultante.

El Leaderboard nunca calcula ni corrige saldos: toma el saldo que transporta el evento y reordena posiciones.

---

# Criterio principal

Los jugadores se ordenan por:

CurrentPoints DESC

---

# Desempates

Si varios jugadores tienen la misma puntuación:

- Comparten posición.
- No se aplica ningún criterio secundario.

Ejemplo

1º Player A — 1500

2º Player B — 1200

2º Player C — 1200

4º Player D — 900

---

# Actualización

El Leaderboard se actualiza automáticamente tras cualquier evento que modifique la puntuación.

Nunca utiliza polling.

---

# Pipeline

WalletUpdated

↓

Leaderboard Update

↓

Recalculate Positions

↓

Compare Previous Ranking

↓

Emit RankingUpdated

↓

Notify Clients

---

# Snapshot

El sistema podrá generar en cualquier momento un Snapshot completo.

LeaderboardSnapshot

tournamentId

timestamp

entries[]

---

# Entry

LeaderboardEntry

playerId

position

points

---

# Integración con Runtime

El Runtime puede consultar el Leaderboard en cualquier momento.

El Leaderboard nunca modifica el Runtime.

---

# Integración con UI

La UI únicamente consume snapshots o eventos.

Nunca calcula posiciones localmente.

---

# Integración con Final Challenge

Cuando un jugador obtiene ¡¡THE PARROT'S SHELL!! la clasificación deja de actualizarse.

El resultado final será:

1º

Jugador que obtiene ¡¡THE PARROT'S SHELL!!

2º+

Resto de jugadores ordenados por puntos.

Si la partida termina en derrota colectiva (DEFEAT, SPEC-001), no existe poseedor de la Shell: la clasificación final se ordena únicamente por puntos.

---

# Eventos

LeaderboardUpdated

PlayerPositionChanged

FinalLeaderboardGenerated

---

# Casos límite

Jugador desconectado

↓

Permanece en la clasificación.

---

Dos jugadores con la misma puntuación

↓

Comparten posición.

---

Jugador abandona la partida

↓

Permanece en la clasificación como participante pasivo, conservando sus puntos (política de abandono de SPEC-023).

---

# Restricciones

El Leaderboard nunca modifica:

Economy.

Runtime.

Board.

Shop.

Inventory.

Boss.

Gambling.

---

# Criterios de aceptación

✓ El Economy System es la única fuente de puntuación.

✓ El Leaderboard se actualiza exclusivamente mediante eventos.

✓ Los empates comparten posición.

✓ El jugador que obtiene ¡¡THE PARROT'S SHELL!! siempre ocupa la primera posición.

✓ El resto de jugadores se ordenan por puntos.