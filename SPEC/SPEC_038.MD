# SPEC-038 — Tournament Entry & Lobby

Status: APPROVED (decisiones D6 y D7 resueltas en SPEC-040)

Priority: CRITICAL

Depends on

- SPEC-023 Tournament Match Lifecycle
- SPEC-037 Platform Grounding
- `PrivateLobbiesService` existente (molde)
- `NotificationsService` existente
- `FriendsService` existente

---

# Objetivo

Especificar cómo un jugador crea, encuentra y entra en un Tournament antes de que comience la partida.

Es la primera pantalla que ve el usuario y ninguna otra SPEC la cubre.

---

# Alcance v1

- Lobby privado por invitación de amigos, siguiendo el molde de `PrivateLobbiesService`.
- Unión por PIN de 6 caracteres además de la invitación (D7, SPEC-040): el lobby genera un PIN compartible; el molde de PIN de `PrivateLobbiesService` se reutiliza tal cual.
- Tamaño fijo: 4 jugadores (SPEC-024).
- Guests excluidos (misma política que ranked).
- Cola pública de matchmaking de Tournament: extensión futura.

---

# Flujo

Crear lobby

↓

Invitar amigos (notificación push + inbox, nuevo `type` de notificación)

↓

Los invitados aceptan o rechazan

↓

Lobby completo (4 jugadores)

↓

El creador pulsa Start

↓

Match Lifecycle: Creating → WaitingPlayers → Loading → Running (SPEC-023)

---

# API REST (contratos v1)

Prefijo: `/api/tournaments`

- `POST /tournaments` — crear lobby. Devuelve id del Tournament (estado `pending`).
- `GET /tournaments/:id` — estado del lobby / partida (para hidratar la UI).
- `POST /tournaments/:id/invite` — invitar a un amigo (valida amistad y que no sea guest).
- `POST /tournaments/:id/join` — aceptar invitación.
- `POST /tournaments/join-pin` — unirse mediante PIN (valida que el lobby exista, no esté lleno y no haya expirado).
- `POST /tournaments/:id/leave` — salir antes de empezar (si sale el creador, el lobby se cancela).
- `POST /tournaments/:id/start` — solo el creador; exige lobby completo.

Guards: JWT + CSRF en mutaciones + exclusión de guests, como el resto de la plataforma.

Los eventos WS del lobby (`tournament:lobby-updated`, `tournament:starting`, etc.) viven en el archivo único de contratos del módulo (SPEC-037).

---

# Ciclo de vida del lobby

- El lobby es una fila `tournaments` en estado `pending` (SPEC-037): sobrevive a un refresh del navegador.
- Expiración configurable sin completar (v1: 10 minutos) → cancelado.
- El creador puede cancelar en cualquier momento antes de Start.
- Un jugador solo puede estar en un lobby/Tournament a la vez (misma regla que colas y partidas).

---

# Orden de juego visible (requisito del subject)

El módulo del subject exige mostrar quién juega y en qué orden.

Al completarse el lobby y antes de iniciar, la UI muestra:

- Los 4 participantes.
- El orden de turno de la primera ronda (TurnOrder generado por el Runtime con la seed del Tournament).

Durante la partida, el HUD mantiene visible el orden de turnos de la ronda actual.

Decisión D6 (SPEC-040, resuelta): el board mode con registro de participantes y orden de juego visible es la interpretación adoptada para el módulo del subject.

---

# Eventos

TournamentLobbyCreated

TournamentInviteSent

TournamentPlayerJoined

TournamentPlayerLeft

TournamentLobbyCancelled

TournamentLobbyCompleted

TournamentStartRequested

---

# Casos límite

Invitado ya en otra partida o cola

↓

Rechazar join con error claro.

---

Creador se desconecta con el lobby abierto

↓

El lobby persiste hasta su expiración; puede volver y continuar.

---

Lobby expira

↓

Cancelar, notificar a los presentes, liberar a los jugadores.

---

# Restricciones

Nunca reimplementar invitaciones: reutilizar notificaciones y amistades existentes.

Nunca añadir handlers de lobby a `matchmaking.gateway.ts` (SPEC-037).

---

# Criterios de aceptación

✓ Un usuario puede crear un lobby, invitar amigos y arrancar un Tournament de 4.

✓ El lobby sobrevive a un refresh (estado en Postgres).

✓ Los guests no pueden participar.

✓ El orden de juego es visible antes de empezar y durante la partida.
