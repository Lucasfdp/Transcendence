# SPEC-023 — Tournament Match Lifecycle

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 Tournament Runtime
- SPEC-003 Tournament State Machine
- SPEC-022 Tournament Networking & Synchronization

---

# Objetivo

Gestionar el ciclo de vida completo de una partida de Tournament.

Este sistema coordina la creación, ejecución y finalización de la partida, pero nunca implementa lógica de gameplay.

---

# Filosofía

El Match Lifecycle es un orquestador.

Nunca toma decisiones de juego.

Únicamente coordina el estado global de la sesión.

---

# Responsabilidades

- Crear la partida.
- Registrar jugadores.
- Esperar a que todos estén preparados.
- Iniciar el Tournament.
- Gestionar abandonos y desconexiones.
- Finalizar correctamente la sesión.

---

# Estados

Creating

↓

WaitingPlayers

↓

Loading

↓

Running

↓

Finished

↓

Closed

No existen transiciones fuera de este flujo salvo cancelación.

---

# Relación con la State Machine del Runtime y el status en BD

Existen dos máquinas de estados deliberadamente separadas:

- El Match Lifecycle es la máquina de SESIÓN: único propietario de la admisión de jugadores y de la cancelación.
- La State Machine del Runtime (SPEC-003) es la máquina de JUEGO: sus estados previos a Running reflejan la fase de sesión.

Correspondencia canónica:

| Match Lifecycle | State Machine (SPEC-003) | `tournaments.status` (BD) |
| --- | --- | --- |
| Creating | CREATED | pending |
| WaitingPlayers | WAITING_PLAYERS | pending |
| Loading | INITIALIZING | active |
| Running | ROUND_START … REWARDS | active |
| Finished | FINISHED (vía VICTORY/REWARDS o DEFEAT) | finished |
| Closed | FINISHED (recursos liberados) | finished |
| Cancelación | CANCELLED | cancelled |

Causas de cancelación (las únicas): reinicio del servidor, timeout con todos desconectados, jugadores activos < 2, cancelación administrativa, error durante la creación.

En todos los casos el Match Lifecycle solicita al Runtime la transición explícita a CANCELLED (SPEC-003); nunca manipula la State Machine directamente.

---

# Creación

Pipeline

Create Tournament

↓

Allocate Match

↓

Initialize Runtime

↓

Register Players

↓

Waiting Players

---

# Inicio

La partida únicamente comenzará cuando:

- Todos los jugadores estén conectados.
- Todos hayan cargado correctamente.
- El Runtime esté inicializado.

---

# Jugadores

Cada jugador posee uno de los siguientes estados:

Connecting

Connected

Ready

Disconnected

Abandoned

Finished

Los guests no pueden participar en Tournament (misma política que las partidas ranked).

---

# Desconexión

Si un jugador pierde la conexión:

↓

Disconnected

↓

El Tournament continúa.

El jugador podrá reconectarse mientras la partida permanezca activa.

---

# Reconexión

Pipeline

Reconnect

↓

Authenticate

↓

Aplicar snapshot actual (SPEC-022: el snapshot ES el estado; no existe replay de eventos)

↓

Connected

---

# Abandono

Si un jugador abandona voluntariamente:

↓

Abandoned

↓

No podrá volver a unirse.

Política v1:

El jugador permanece en la partida como participante pasivo.

Sus turnos se auto-resuelven (tirada automática, sin compras ni Items).

Nunca se le incluye en los minijuegos ni en el Gambling: los minijuegos se lanzan solo con jugadores activos (SPEC-015).

Conserva sus puntos y su posición en el Leaderboard.

Si los jugadores activos caen por debajo de 2, el Tournament se cancela.

La arquitectura deberá soportar futuras políticas (IA sustituta, eliminación, etc.).

---

# Persistencia

El Tournament es una sesión de larga duración: su estado nunca puede vivir únicamente en memoria.

Estado persistido en Postgres (SPEC-037):

- `tournaments` (estado, configuración, snapshot del Runtime).
- `tournament_participants`.
- `tournament_matches` (enlace de cada minijuego a `matches.id` por ronda).

El snapshot del Runtime se actualiza tras cada transición de la State Machine.

La memoria actúa únicamente como caché de trabajo.

---

# Reinicio del servidor

v1: al arrancar, los torneos con estado en curso se marcan cancelados (misma política que hoy aplica `GameSessionService.onModuleInit` a las partidas activas huérfanas).

El diseño (snapshot serializable + estado en BD) deberá permitir implementar reanudación en el futuro sin cambios estructurales.

---

# Finalización

El Match termina cuando:

- Un jugador obtiene ¡¡THE PARROT'S SHELL!!.
- Se alcanza la ronda máxima sin completar los Key Items (derrota colectiva, DEFEAT en SPEC-001).
- La partida es cancelada por el sistema.
- Un administrador la finaliza.

---

# Cierre

Pipeline

Tournament Finished

↓

Persist Results

↓

Release Resources

↓

Close Match

↓

Destroy Runtime

---

# Integración con Runtime

El Runtime nunca crea ni destruye partidas.

El Match Lifecycle controla completamente su ciclo de vida.

---

# Integración con Networking

El Networking informa:

Connected

Disconnected

Reconnected

El Match Lifecycle decide cómo afecta al estado de la sesión.

---

# Integración con Analytics

Registrar:

- Duración.
- Número de jugadores.
- Reconexiones.
- Abandonos.
- Cancelaciones.
- Ganador.

---

# Eventos

MatchCreated

PlayerJoined

PlayerReady

MatchStarted

PlayerDisconnected

PlayerReconnected

PlayerAbandoned

MatchFinished

MatchClosed

---

# Casos límite

Host desconectado

↓

Sin impacto.

No existe Host lógico.

El servidor controla la partida.

---

Todos los jugadores desconectados

↓

Timeout configurable (v1: 10 minutos).

↓

Al expirar, el Tournament se cancela.

---

Error durante creación

↓

Cancelar Match.

Liberar recursos.

---

# Restricciones

El Match Lifecycle nunca:

Gestiona economía.

Gestiona tablero.

Gestiona Boss.

Gestiona Gambling.

Gestiona Shop.

Gestiona Minijuegos.

Gestiona Inventario.

Toda la lógica pertenece al Runtime y a los sistemas especializados.

---

# Criterios de aceptación

✓ El ciclo de vida completo está centralizado.

✓ El servidor controla toda la sesión.

✓ La partida soporta reconexiones.

✓ No existe dependencia de un Host.

✓ El Runtime se destruye correctamente al finalizar la partida.