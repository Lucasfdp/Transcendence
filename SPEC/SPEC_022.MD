# SPEC-022 — Tournament Networking & Synchronization

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 Tournament Runtime
- SPEC-003 Tournament State Machine
- SPEC-004 Tournament Event Bus

---

# Objetivo

Garantizar que todos los jugadores observan exactamente el mismo estado del Tournament en todo momento.

El servidor será siempre la única fuente de verdad.

Toda decisión de gameplay deberá resolverse exclusivamente en el servidor.

---

# Filosofía

El cliente nunca toma decisiones.

El cliente únicamente:

- Envía intenciones.
- Recibe actualizaciones.
- Reproduce el estado autorizado por el servidor.

---

# Autoridad

Server Authoritative

El servidor controla:

- Turnos.
- Tiradas de dados.
- Movimiento.
- Economía.
- Gambling.
- Shop.
- Key Items.
- Boss.
- Final Challenge.
- Resultado de la partida.

El cliente nunca calcula estos elementos.

---

# Responsabilidades

- Validar acciones recibidas.
- Sincronizar el estado.
- Distribuir eventos.
- Resolver conflictos.
- Mantener consistencia.

---

# Arquitectura

Client

↓

Intent

↓

Server

↓

Tournament Runtime

↓

Event Bus

↓

Snapshots / Events

↓

Clients

---

# Intents

Los clientes únicamente pueden solicitar acciones.

Ejemplos

RollDiceIntent

UseItemIntent

BuyOfferIntent

StartGamblingIntent

LeaveGamblingIntent

EndTurnIntent

Nunca envían resultados.

---

# Validación

Toda Intent será validada antes de ejecutarse.

Si la validación falla:

↓

Rejected

↓

No modifica el Runtime.

---

# Estado

El estado oficial pertenece exclusivamente al servidor.

Los clientes mantienen una copia temporal.

---

# Sincronización — Snapshot First

El estado de un Tournament es pequeño (tablero, posiciones, wallets, progreso). Se sincroniza con el mismo patrón que ya usa la plataforma para `game:state`:

- Tras cada cambio autoritativo, el servidor difunde el SNAPSHOT COMPLETO del estado visible con un `seq` monotónico.

- El estado del cliente es siempre el último snapshot recibido. Un snapshot con `seq` menor o igual al actual se descarta.

- Los eventos incrementales `tournament:*` son exclusivamente pistas de presentación (animaciones, sonidos, mensajes). NUNCA son fuente de estado: perder uno no desincroniza nada.

El cliente no reconstruye estado a partir de eventos. No existe replay de eventos pendientes ni ordering más allá de `seq`.

Nunca sincronización mediante polling.

---

# Desincronización

El diseño snapshot-first la elimina por construcción: el siguiente snapshot corrige cualquier estado local.

Si un cliente lo necesita (p. ej. tras reconectar), puede solicitar el snapshot actual explícitamente.

Nunca intentar corregir el estado por su cuenta.

---

# Latencia

La latencia nunca modifica el resultado del gameplay.

Únicamente afecta a la presentación visual.

---

# Reconexión

Un jugador podrá reconectarse.

Al reconectar:

↓

Snapshot completo (estado actual).

↓

Continuar partida.

No existe replay de eventos pendientes: el snapshot ES el estado.

---

# Desconexión

La gestión funcional de jugadores desconectados pertenece al Match Lifecycle.

Este sistema únicamente garantiza la sincronización.

---

# Implementación

La sincronización reutiliza la infraestructura Socket.IO existente (path `/ws/`, auth por cookie JWT en el handshake, salas por partida).

Los eventos del Tournament usan el prefijo `tournament:*` y sus handlers viven en el módulo del Tournament, nunca dentro de `matchmaking.gateway.ts` (SPEC-037).

Los contratos de eventos se definen en un único archivo de tipos y se espejan conscientemente en el frontend.

---

# Eventos

ClientConnected

ClientDisconnected

SnapshotSent

SnapshotApplied

IntentAccepted

IntentRejected

StateSynchronized

---

# Casos límite

Snapshot con seq antiguo

↓

Descartar.

---

Evento de presentación duplicado o perdido

↓

Sin impacto en el estado (solo presentación).

---

Cliente modificado

↓

Rechazar cualquier acción inválida.

---

# Restricciones

El cliente nunca:

Calcula resultados.

Modifica economía.

Decide tiradas.

Genera Key Items.

Determina ganadores.

---

# Criterios de aceptación

✓ El servidor controla toda la lógica.

✓ El cliente únicamente representa el estado.

✓ Toda acción pasa por validación.

✓ Todos los jugadores observan el mismo estado.

✓ El sistema soporta reconexión mediante snapshots.