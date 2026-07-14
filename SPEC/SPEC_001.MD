# SPEC-001 — Tournament Runtime

Status: APPROVED

Priority: CRITICAL

Dependencies:
- MatchFactoryService (existente: `backend/src/modules/matchmaking/match-factory.service.ts`)
- MatchLifecycleEvents (existente: `backend/src/modules/matchmaking/match-lifecycle.events.ts`)
- Tournament Gambling (SPEC-016: primitivas provably-fair del casino sobre puntos del torneo)
- Existing Matchmaking
- Existing Minigames
- Economy System (SPEC-011: puntos efímeros del torneo)
- SPEC-037 Platform Grounding

---

# Objetivo

Tournament Runtime es el sistema principal del modo Tournament.

NO contiene gameplay.

NO contiene lógica de minijuegos.

NO contiene lógica de gambling.

Su única responsabilidad es orquestar el flujo completo de una partida de Tournament utilizando los sistemas existentes de la plataforma.

Debe comportarse como una máquina de estados.

Debe ser completamente server authoritative.

Debe ser extensible.

Debe ser completamente data-driven.

---

# Responsabilidades

Tournament Runtime será responsable de:

- Crear el estado del torneo.
- Mantener el estado del tablero.
- Gestionar rondas.
- Gestionar turnos.
- Lanzar minijuegos.
- Esperar resultados.
- Abrir la fase de Gambling.
- Actualizar el progreso de objetos.
- Detectar el desbloqueo del Boss.
- Lanzar el desafío final.
- Finalizar la partida.
- Entregar recompensas.

No implementará ninguno de estos sistemas.

Solo los coordina.

---

# Responsabilidades explícitamente prohibidas

Tournament Runtime nunca podrá:

Crear partidas manualmente.

Implementar matchmaking.

Implementar gambling.

Implementar minijuegos.

Implementar economía.

Implementar recompensas.

Implementar inventario.

Implementar networking específico.

Todo eso pertenece a otros módulos.

---

# Arquitectura

Tournament Runtime es un Orchestrator.

Todos los demás módulos son consumidores o proveedores de información.

                Tournament Runtime

        ↓             ↓              ↓

 Board     Minigames     Gambling

        ↓             ↓              ↓

 Rewards    MatchFactory     MatchLifecycleEvents

---

# Máquina de estados

CREATED

↓

WAITING_PLAYERS

↓

INITIALIZING

↓

ROUND_START

↓

PLAYER_TURNS

↓

MINIGAME

↓

GAMBLING_PHASE

↓

CHECK_KEY_ITEMS

↓

BOSS_EVENT

↓

FINAL_CHALLENGE

↓

VICTORY

↓

REWARDS

↓

FINISHED

Existe además un estado terminal alternativo:

CHECK_KEY_ITEMS

↓

DEFEAT

↓

FINISHED

(solo alcanzable al agotar la ronda máxima sin completar los Key Items; ver descripción más abajo)

Existe además un estado terminal CANCELLED, alcanzable desde cualquier estado no terminal, únicamente a petición del Match Lifecycle (SPEC-023): reinicio del servidor, timeout con todos los jugadores desconectados, jugadores activos < 2 o cancelación administrativa.

Esta lista es la canónica del proyecto y es idéntica a la de SPEC-003.

Ningún otro documento define estados propios.

---

# Descripción de estados

## CREATED

El torneo existe.

No hay jugadores inicializados.

---

## WAITING_PLAYERS

Esperando jugadores.

Cuando todos estén listos:

↓

INITIALIZING

CREATED y WAITING_PLAYERS reflejan la fase de sesión propiedad del Match Lifecycle (Creating / WaitingPlayers, SPEC-023): el Runtime transiciona al recibir sus eventos (PlayerReady, MatchStarted). Ver la tabla de correspondencia en SPEC-023.

---

## INITIALIZING

Inicializar:

Board

Leaderboard

TurnOrder

Inventory temporal

Consumables

Key Progress

Round = 1

El TurnOrder se genera con la seed del Tournament y es FIJO durante toda la partida: no rota entre rondas (D13, SPEC-040).

---

## ROUND_START

Preparar nueva ronda.

Seleccionar primer jugador (según el TurnOrder fijo generado en INITIALIZING).

Resetear estados temporales.

---

## PLAYER_TURNS

Cada jugador ejecuta exactamente un turno.

Turno:

Tirar dado

↓

Mover

↓

Resolver casilla

↓

Fin turno

Cuando todos terminan

↓

MINIGAME

Si todos los Key Items se desbloquearon durante la ronda (p. ej. compra en tienda):

↓

CHECK_KEY_ITEMS

(se omiten minijuego y gambling de esa ronda)

---

## MINIGAME

Cubre selección, ejecución y espera de resultados.

Seleccionar un minijuego aleatorio del catálogo existente, filtrado por los que soporten el número de jugadores ACTIVOS del Tournament.

Jugador activo: conectado y no abandonado en el momento de crear la partida.

Los jugadores pasivos (abandonados) y los desconectados nunca se incluyen en el minijuego: observan el resultado.

Si los jugadores activos son menos de 2, el minijuego de esa ronda se omite (→ CHECK_KEY_ITEMS).

Crear la partida mediante MatchFactoryService (arranque server-initiated, sin ready-check manual).

Esperar el evento `finished` / `abandoned` de MatchLifecycleEvents.

No bloquear el servidor.

La espera está protegida por el watchdog de reconciliación de SPEC-015 (v1: 10 minutos, SPEC-024): nunca puede quedar bloqueada indefinidamente.

El sistema existente determina un ganador (winnerSide) y un outcome por jugador. No existe clasificación ordenada completa.

Todos los participantes activos reciben puntos según su outcome: el ganador una cantidad mayor y el resto una menor (PointsReward mediante Reward Resolver, source Minigame; valores v1 en SPEC-024). Los pasivos y desconectados no reciben nada.

Si existe ganador único:

↓

GAMBLING_PHASE

Si termina en empate o cancelada sin resultado:

↓

CHECK_KEY_ITEMS

(la fase de Gambling se omite esa ronda)

---

## GAMBLING_PHASE

Solo se entra a esta fase si el minijuego produjo un ganador único y quedan Key Items bloqueados.

Si el ganador está desconectado o abandonado, la fase se omite (→ CHECK_KEY_ITEMS).

Solo participa:

Ganador del minijuego.

El resto de jugadores observa la fase en directo (la UI difunde el estado a todos).

La pantalla se abre aunque el ganador no tenga puntos suficientes.

La decisión tiene un timeout configurable (v1: 30 segundos). Al expirar, la fase se resuelve como abandono.

El jugador puede:

Gamble

Abandonar

Si abandona

↓

CHECK_KEY_ITEMS

Si apuesta

Verificar puntos.

Si no tiene suficientes:

Finalizar fase.

Si tiene suficientes:

Descontar puntos (Economy System del Tournament).

Resolver mediante Tournament Gambling (SPEC-016).

Resultado:

Win

↓

Se desbloquea el siguiente Key Item bloqueado (global)

Lose

↓

Nada

↓

CHECK_KEY_ITEMS

---

## CHECK_KEY_ITEMS

Si Key Items desbloqueados == requeridos

↓

BOSS_EVENT

Si Key Items desbloqueados < requeridos y no se alcanzó la ronda máxima

↓

ROUND_START

Anti-estancamiento (D3, SPEC-040 — RESUELTO):

La probabilidad de victoria del Gambling aumenta por cada ronda completada sin desbloquear un Key Item y se restablece al desbloquear uno (pity; valores en SPEC-024).

Si se alcanza la ronda máxima configurada (v1: 15) sin completar los Key Items

↓

DEFEAT

(derrota colectiva: nadie obtiene THE PARROT'S SHELL; la partida siempre tiene duración acotada)

---

## DEFEAT

Estado terminal alternativo (D3, SPEC-040).

Se alcanzó la ronda máxima sin completar los Key Items.

Congelar partida.

No existe ganador. Nadie obtiene THE PARROT'S SHELL.

Leaderboard final ordenado únicamente por puntos.

No se entregan recompensas persistentes de campeón (los minijuegos ya pagaron por partida mediante el flujo existente).

`winnerUserId` queda nulo; status `finished` (SPEC-037).

↓

FINISHED

---

## CANCELLED

Estado terminal alternativo.

Solo el Match Lifecycle (SPEC-023) puede solicitarlo, desde cualquier estado no terminal.

Congelar y liberar la partida. No existe ganador ni Leaderboard final oficial.

Status `cancelled` en BD (SPEC-037). Emite TournamentCancelled.

No existen transiciones posteriores.

---

## BOSS_EVENT

Cambio de temática.

Aparición del Boss.

No existe combate real.

Preparar desafío final.

↓

FINAL_CHALLENGE

---

## FINAL_CHALLENGE

Mecánica v1 definida en SPEC-021: muerte súbita de minijuegos.

El primer jugador que gane un minijuego del desafío obtiene

THE PARROT'S SHELL.

↓

VICTORY

---

## VICTORY

Calcular:

Ganador

Leaderboard

Recompensas

↓

REWARDS

---

## REWARDS

Recompensas persistentes de cuenta: utilizar exclusivamente los sistemas existentes de la plataforma (game-results, achievements, customization) según SPEC-037.

Las recompensas internas de la partida ya fueron resueltas durante el juego por el Reward Resolver (SPEC-013).

No implementar un segundo sistema de recompensas.

↓

FINISHED

---

# Eventos consumidos

PlayerReady

MatchStarted

MatchFinished

PlayerDisconnected

PlayerReconnected

PlayerAbandoned

GamblingFinished

---

# Eventos emitidos

Eventos propiedad del Runtime (catálogo canónico en SPEC-004):

TournamentCreated

TournamentStarted

RoundStarted

RoundFinished

RewardsGranted

TournamentFinished

TournamentCancelled

Los demás eventos del flujo (PlayerTurnStarted / PlayerTurnFinished, Minigame*, Gambling*, KeyItemUnlocked, BossSpawned, FinalChallengeStarted…) los emiten sus sistemas propietarios según el catálogo de SPEC-004; el Runtime los consume u orquesta, nunca los emite.

---

# Datos mantenidos

TournamentState

Round

TurnOrder

BoardState

Leaderboard

UnlockedKeyItems

CurrentPhase

BossState

FinalWinner

---

# Invariantes

Siempre existe exactamente una fase activa.

Solo un jugador tiene turno.

Los Key Items son globales.

Los puntos son individuales.

Existe como máximo un ganador (ninguno si la partida termina en DEFEAT o CANCELLED).

Cuando existe ganador, siempre obtiene THE PARROT'S SHELL.

---

# Integraciones

MatchFactoryService

Tournament Runtime nunca crea partidas.

Siempre llama a MatchFactoryService.

---

MatchLifecycleEvents

Tournament Runtime nunca pregunta continuamente por el estado.

Siempre reacciona a eventos.

---

Gambling

Utilizar Tournament Gambling (SPEC-016): las primitivas provably-fair del casino existente aplicadas sobre los puntos del torneo.

El CasinoEngine (monedas persistentes) no participa y no se modifica.

---

Minijuegos

Siempre reutilizar los existentes.

Nunca crear lógica específica.

---

Rewards

Recompensas internas de partida: Reward Resolver (SPEC-013).

Recompensas persistentes de cuenta: sistemas existentes de la plataforma (SPEC-037).

---

# Casos límite

Jugador sin puntos suficientes

↓

Puede abrir Gambling.

↓

No puede apostar.

↓

Finaliza la fase.

---

Jugador desconectado

↓

Sus turnos se auto-resuelven (tirada automática, sin compras ni uso de Items).

↓

Puede reconectarse mientras la partida siga activa (SPEC-023).

---

Empate en minijuego

↓

No hay ganador de ronda.

↓

La fase de Gambling se omite esa ronda.

---

Ganador del minijuego desconectado al abrir Gambling

↓

La fase se omite (equivale a abandono).

---

Ganador del minijuego no decide

↓

Timeout de decisión (v1: 30 segundos).

↓

La fase se resuelve como abandono.

---

Servidor reiniciado

↓

El estado se persiste en Postgres tras cada transición (SPEC-023).

↓

v1: los torneos en curso se marcan cancelados al arrancar.

↓

El diseño debe permitir implementar reanudación en el futuro.

---

# Criterios de aceptación

✓ Tournament Runtime no contiene lógica de minijuegos.

✓ Tournament Runtime no contiene lógica de gambling.

✓ Tournament Runtime es únicamente un orquestador.

✓ Todo el flujo puede representarse mediante la máquina de estados.

✓ Todo el sistema funciona utilizando MatchFactoryService.

✓ Todo el sistema reacciona a MatchLifecycleEvents.
