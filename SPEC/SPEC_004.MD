# SPEC-004 — Tournament Event Bus

Status: APPROVED

Priority: CRITICAL

Depends on:

- SPEC-001 Tournament Runtime
- SPEC-002 Board System
- SPEC-003 Tournament State Machine

---

# Objetivo

Tournament debe ser completamente dirigido por eventos.

Ningún sistema debe conocer la implementación interna de otro sistema.

Los módulos se comunican exclusivamente mediante eventos.

Esto reduce el acoplamiento entre componentes y permite extender el juego sin modificar sistemas existentes.

---

# Implementación

El Event Bus es un emisor tipado en proceso, con una instancia por Tournament.

No es Socket.IO: los eventos de sincronización con clientes (SPEC-022) son una capa distinta que escucha este bus y decide qué difundir.

Puede implementarse con una clase propia ligera (mismo patrón que `MatchLifecycleEvents` existente) o `@nestjs/event-emitter`, siempre con orden garantizado y aislamiento de errores por listener.

---

# Filosofía

Incorrecto

Board

↓

Shop.open()

Correcto

Board

↓

EventBus.emit(ShopRequested)

↓

Shop escucha ese evento

↓

Abre la tienda

---

El Board nunca sabe que existe una tienda.

---

# Responsabilidades

El Event Bus será responsable de:

- registrar listeners
- emitir eventos
- distribuir eventos
- mantener orden de ejecución
- garantizar entrega durante la partida

Nunca contendrá lógica de gameplay.

Nunca modificará estado.

Nunca decidirá nada.

---

# Arquitectura

Tournament Runtime

↓

Event Bus

↓

Todos los sistemas

Board

Shop

Economy

Boss

Minigames

UI

Audio

Analytics

---

# Comandos y Eventos

Existen dos vías de comunicación y no deben confundirse.

## Comandos

Operaciones que necesitan una respuesta síncrona (validación, rechazo, resultado).

Se realizan mediante llamadas directas a la API pública del sistema propietario.

Ejemplos

Shop → Economy.Remove() (necesita saber si la compra procede)

Reward Resolver → Inventory.Add() (necesita saber si hay espacio)

AttemptStealAction → Economy.Transfer()

Un comando nunca accede al estado interno de otro sistema: siempre usa su API pública.

## Eventos

Hechos ya ocurridos. Son notificaciones inmutables.

Los emite el sistema propietario del estado después de modificarlo.

Ejemplos

Economy modifica la Wallet → emite PointsAwarded

Inventory añade un Item → emite ItemAdded

UI, Audio, Leaderboard y Analytics reaccionan exclusivamente a eventos.

## Regla

El camino de mando (mutación con resultado) es un comando síncrono a una API pública.

El camino de reacción (UI, vistas, sistemas derivados, analytics) es siempre mediante eventos.

Está prohibido implementar mutaciones de estado como listeners de eventos cuando el emisor necesita conocer el resultado.

---

# Principio Fundamental

Ningún sistema reacciona al estado de otro consultándolo ni accediendo a su implementación.

Toda reacción ocurre porque alguien emitió un evento.

Toda mutación con resultado ocurre mediante un comando a una API pública.

---

# Tipos de Eventos

Existen cuatro categorías.

---

## Tournament Events

Controlan el flujo principal.

Ejemplos

TournamentCreated

TournamentStarted

TournamentFinished

RoundStarted

RoundFinished

---

## Board Events

Relacionados con movimiento.

PlayerMoved

TileEntered

TileResolved

MovementFinished

---

## Gameplay Events

Relacionados con reglas.

PointsAwarded

PointsRemoved

StealStarted

StealSucceeded

ConsumableUsed

ShopOpened

ItemPurchased

---

## Integration Events

Provienen de sistemas externos.

MatchStarted

MatchFinished

GamblingFinished

RewardGranted

FriendDisconnected

---

# Estructura

Todo evento deberá contener:

EventId

Timestamp

TournamentId

Round

PlayerId (nullable)

Payload

Metadata

Nunca más.

---

# Payload

Cada evento define su propio Payload.

Ejemplo

PointsAwarded

Payload

amount

reason

source

Nunca utilizar diccionarios genéricos.

Siempre tipos concretos.

---

# Orden de ejecución

Los eventos deberán procesarse en el mismo orden en que fueron emitidos.

Nunca en paralelo dentro de una misma partida.

Entre partidas distintas sí podrán ejecutarse en paralelo.

---

# Listeners

Cada sistema escucha únicamente los eventos que necesita.

Ejemplo

Shop escucha

ShopRequested

Boss escucha

KeyItemUnlocked

Leaderboard escucha

WalletUpdated

El movimiento no es un evento: es un comando a la API pública del Board (SPEC-002).

---

# Prohibiciones

Nunca emitir eventos desde constructores.

Nunca emitir eventos durante la destrucción de objetos.

Nunca crear ciclos de eventos: un listener nunca puede provocar (directa o indirectamente) una nueva emisión del mismo tipo de evento que está procesando.

Nunca depender del orden de registro de listeners.

---

# Event Chaining

Permitido.

Ejemplo

PlayerMoved

↓

TileEntered

↓

ShopOpened

↓

ItemPurchased

↓

PointsRemoved

Cada evento debe ser independiente.

---

# Catálogo Canónico de Eventos

Este catálogo es el canónico del proyecto y la ÚNICA fuente de verdad de eventos.

Reglas:

- Cada evento tiene exactamente UN sistema propietario, que es el único autorizado a emitirlo.
- Ningún evento consumido puede carecer de propietario.
- Las SPEC de módulo listan sus eventos únicamente como referencia a este catálogo; en caso de discrepancia, prevalece este documento.
- Añadir un evento nuevo exige registrarlo aquí (con propietario) en la misma tarea.

## Catálogo por propietario

| Propietario (único emisor) | Eventos |
|---|---|
| Tournament Runtime (SPEC-001) | TournamentCreated, TournamentStarted, RoundStarted, RoundFinished, RewardsGranted, TournamentFinished, TournamentCancelled |
| State Machine (SPEC-003) | StateEntered, StateExited, TransitionStarted, TransitionCompleted, TransitionFailed |
| Turn System (SPEC-005) | PlayerTurnStarted, PlayerTurnFinished, DiceRollRequested |
| Dice System (SPEC-010) | DiceRolled, DiceModified |
| Board System (SPEC-002) | PlayerMoved, TileEntered, TileResolved, MovementFinished |
| Action Engine — Actions (SPEC-006/008) | ShopRequested, RandomEventRequested, BossSpawnRequested, StealStarted, StealSucceeded, StealFailed, DisplayMessage, PlayAnimation, PlaySound |
| Economy System (SPEC-011) | PointsAwarded, PointsRemoved, PointsTransferred, EconomyRejected, WalletUpdated |
| Shop System (SPEC-012) | ShopOpened, OfferSelected, PurchaseRequested, ItemPurchased, PurchaseRejected, ShopClosed |
| Reward Resolver (SPEC-013) | RewardGranted, RewardRejected, RewardResolved, CompositeRewardStarted, CompositeRewardFinished |
| Inventory System (SPEC-014) | InventoryUpdated, ItemAdded, ItemRemoved, ConsumableUsed, InventoryFull, InventoryEmpty |
| Minigame Integration (SPEC-015) | MinigameSelectionStarted, MinigameSelected, MinigameLoading, MinigameStarted, MinigameFinished, MinigameCancelled |
| Gambling Integration (SPEC-016) | GamblingOpened, GamblingStarted, GamblingFinished, GamblingWon, GamblingLost, GamblingCancelled |
| Key Item Progression (SPEC-017) | KeyItemUnlocked, KeyItemProgressUpdated, AllKeyItemsUnlocked, FinalChallengeUnlocked |
| Rule Engine (SPEC-009) | RuleActivated, RuleUpdated, RuleExpired, RuleRemoved |
| Random Events (SPEC-019) | RandomEventSelected, RandomEventStarted, RandomEventFinished, RandomEventCancelled |
| Boss System (SPEC-020) | BossSpawned, BossRulesActivated, BossRulesRemoved, BossIntroCompleted, BossFinished |
| Final Challenge (SPEC-021) | FinalChallengeStarted, VictoryConditionReached, ShellGranted, FinalChallengeFinished |
| Match Lifecycle (SPEC-023) | MatchCreated, PlayerJoined, PlayerReady, MatchStarted, PlayerDisconnected, PlayerReconnected, PlayerAbandoned, MatchFinished, MatchClosed |
| Networking (SPEC-022) | ClientConnected, ClientDisconnected, SnapshotSent, SnapshotApplied, IntentAccepted, IntentRejected, StateSynchronized |
| Entry & Lobby (SPEC-038) | TournamentLobbyCreated, TournamentInviteSent, TournamentPlayerJoined, TournamentPlayerLeft, TournamentLobbyCancelled, TournamentLobbyCompleted, TournamentStartRequested |
| Configuration (SPEC-024) | ConfigurationLoaded, ConfigurationValidated, ConfigurationRejected |
| Registry Framework (SPEC-025) | RegistryLoaded, RegistryValidated, RegistryReady, RegistryError |

## Eventos de control de flujo

Eventos cuya recepción desbloquea una espera del Runtime / State Machine / Turn System:

| Evento | Propietario | Espera que desbloquea |
|---|---|---|
| PlayerTurnFinished | Turn System | State Machine: siguiente jugador / fin de PLAYER_TURNS |
| DiceRolled | Dice System | Turn System: continuar con el movimiento |
| PlayerMoved / TileResolved / MovementFinished | Board | Turn System: continuar el turno |
| ShopClosed | Shop | Turn System: cierre de la ventana de interacción (SPEC-005/012) |
| MatchFinished / abandoned | Match Lifecycle (plataforma) | Runtime: salir de MINIGAME y FINAL_CHALLENGE |
| GamblingFinished | Gambling Integration | Runtime: salir de GAMBLING_PHASE (cualquier desenlace) |
| AllKeyItemsUnlocked | Key Item Progression | Runtime: evaluación en CHECK_KEY_ITEMS |
| BossIntroCompleted | Boss System | State Machine: BOSS_EVENT → FINAL_CHALLENGE |
| FinalChallengeFinished | Final Challenge | State Machine: → VICTORY |
| PlayerAbandoned / PlayerDisconnected / PlayerReconnected | Match Lifecycle | Runtime: auto-resolución de turnos, filtros de minijuego/gambling |

## Nombres retirados (no usar)

Nombres que aparecieron en versiones anteriores de las SPEC y quedan prohibidos:

- MovePlayer, MovementRequested, TeleportRequested → el movimiento es un COMANDO a la API pública del Board (SPEC-002), nunca un evento.
- DiceRequested → DiceRollRequested. DiceResult → DiceRolled.
- TurnCompleted, PlayerFinishedTurn → PlayerTurnFinished.
- PurchaseCompleted → ItemPurchased. ItemConsumed → ConsumableUsed.
- PointsChanged → WalletUpdated.
- PlayerLeft → PlayerAbandoned.
- BossReady → BossIntroCompleted.
- PlayerEnteredShop → ShopRequested.
- PlayerStopped, MovementInterrupted → eliminados (nada los emitía ni consumía).

---

# Integración con Runtime

El Runtime nunca llamará directamente a otros sistemas.

Siempre emitirá eventos.

Ejemplo

Incorrecto

Runtime

↓

Shop.open()

Correcto

Runtime

↓

emit(ShopRequested)

↓

Shop responde

---

# Integración con UI

La UI nunca consulta continuamente el estado.

Escucha eventos.

Ejemplo

PointsAwarded

↓

Animación

↓

Actualizar marcador

---

# Integración con Audio

El Audio escucha eventos.

Nunca consulta lógica.

Ejemplo

BossSpawned

↓

Reproducir música

---

# Integración con Analytics

Analytics nunca modifica nada.

Solo escucha.

Ejemplo

TournamentFinished

↓

Guardar estadísticas

---

# Integración con Futuras Features

Replay

Spectator

Achievements

Streaming

Logs

Moderación

Todo funcionará escuchando eventos existentes.

No requerirá modificar gameplay.

---

# Casos límite

Listener lanza excepción

↓

No detener Tournament.

↓

Registrar error.

↓

Continuar.

---

Listener tarda demasiado

↓

Registrar advertencia.

↓

Nunca bloquear Runtime.

---

Evento sin listeners

↓

No ocurre nada.

↓

No es error.

---

Evento desconocido

↓

Ignorar.

↓

Registrar log.

---

# Restricciones

Los eventos son inmutables.

Una vez emitidos no pueden modificarse.

Nunca reutilizar instancias.

Cada emisión crea un nuevo evento.

---

# Criterios de aceptación

✓ Ningún sistema depende directamente de otro.

✓ Todos los sistemas se comunican mediante eventos.

✓ Añadir una nueva feature no requiere modificar Runtime.

✓ UI, Audio y Analytics funcionan exclusivamente mediante listeners.

✓ El Event Bus contiene cero lógica de negocio.
