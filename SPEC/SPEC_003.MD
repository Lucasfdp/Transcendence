# SPEC-003 — Tournament State Machine

Status: APPROVED

Priority: CRITICAL

Depends on:

- SPEC-001 Tournament Runtime
- SPEC-002 Board System

---

# Objetivo

La Tournament State Machine es el corazón del modo Tournament.

Su única responsabilidad consiste en controlar en qué fase se encuentra la partida y garantizar que únicamente existe una fase activa en cada momento.

No contiene lógica de gameplay.

No contiene lógica de UI.

No contiene lógica de networking.

No contiene lógica de economía.

Su única responsabilidad es controlar el flujo de estados.

---

# Filosofía

Tournament NO funciona mediante ifs.

Tournament NO funciona mediante switches gigantes.

Tournament funciona mediante una máquina de estados.

Cada estado:

- conoce cómo empezar
- conoce cuándo termina
- conoce cuál es el siguiente estado

El Runtime únicamente ejecuta estados.

---

# Estado Global

Existe exactamente UN estado activo.

Nunca dos.

Nunca cero.

---

# Flujo

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

¿Todos los Key Items?

NO

↓

¿Ronda máxima alcanzada? (anti-estancamiento, SPEC-001)

NO → ROUND_START

SI → DEFEAT (derrota colectiva) → FINISHED

SI

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

Existe además el estado terminal CANCELLED (ver más abajo), alcanzable desde cualquier estado no terminal, únicamente a petición del Match Lifecycle (SPEC-023).

Esta lista es la canónica del proyecto y es idéntica a la de SPEC-001.

---

# Interfaz de un Estado

Todos los estados deberán implementar exactamente la misma interfaz.

interface TournamentState

onEnter()

onExit()

update()

canTransition()

nextState()

No deberán existir métodos adicionales.

---

# Responsabilidades

Cada estado únicamente puede modificar aquello que pertenece a su fase.

Ejemplo.

PLAYER_TURNS

Puede:

✔ mover jugadores

✔ cambiar turno

✔ terminar ronda

No puede:

✘ iniciar un minijuego

✘ repartir recompensas

✘ entregar la Shell

---

# Enter

Cuando un estado entra

Puede:

Inicializar datos.

Emitir eventos.

Preparar temporizadores.

Nunca ejecutará lógica larga.

---

# Update

Mientras el estado permanece activo

Puede:

Esperar eventos.

Esperar respuestas.

Esperar jugadores.

No bloqueará nunca el hilo principal.

---

# Exit

Al abandonar un estado

Debe:

Liberar recursos temporales.

Cancelar timers.

Eliminar listeners.

Nunca dejar referencias colgantes.

---

# Transiciones

Las transiciones siempre son explícitas.

Ejemplo

PLAYER_TURNS

↓

Todos los jugadores terminaron

↓

MINIGAME

Nunca

Runtime.phase = ...

Todo cambio pasa por State Machine.

---

# Eventos

Los estados nunca se llaman entre sí.

Toda comunicación será mediante Runtime.

Incorrecto

RoundState

↓

MinigameState.start()

Correcto

RoundState

↓

Runtime.requestTransition()

↓

StateMachine

↓

MinigameState

---

# Player Turns

Este estado contiene un subestado.

PLAYER

↓

MOVE

↓

RESOLVE_TILE

↓

WAITING_INTERACTION

(solo si la Tile abrió una sesión interactiva, p. ej. tienda; protocolo en SPEC-005 y SPEC-012)

↓

END_TURN

↓

NEXT_PLAYER

Cuando no quedan jugadores

↓

MINIGAME

(o CHECK_KEY_ITEMS si todos los Key Items ya están desbloqueados)

---

# Minijuego

El estado

MINIGAME

No sabe qué minijuego existe.

Únicamente espera.

MatchCreated

↓

started

↓

finished / abandoned

↓

Resultados

↓

Salir

Los hitos provienen de MatchLifecycleEvents (SPEC-015).

---

# Gambling

Ocurre siempre que el minijuego produjo un ganador único, conectado y no abandonado, y quedan Key Items bloqueados.

En caso contrario la fase se omite.

Se abre aunque el ganador no tenga puntos (podrá únicamente abandonar).

La decisión tiene timeout configurable (v1: 30 segundos); al expirar se resuelve como abandono.

Flujo

Abrir pantalla

↓

Jugador decide

↓

Abandonar

o

↓

Intentar apostar

↓

¿Tiene puntos?

NO

↓

Cerrar

SI

↓

Resolver mediante Tournament Gambling (SPEC-016)

↓

Esperar resultado

↓

Continuar

---

# Boss Event

Este estado únicamente prepara:

Cambio de ambientación.

Cambio de música.

Cambio de reglas.

Preparación del desafío.

El desafío pertenece al siguiente estado.

---

# Final Challenge

Mecánica v1 definida en SPEC-021 (muerte súbita de minijuegos).

La State Machine únicamente conoce:

Existe.

Tiene ganador.

Produce la Shell.

---

# Victory

Responsabilidad

Congelar partida.

Guardar ganador.

Preparar recompensas.

Nunca repartirlas.

---

# Rewards

Responsabilidad

Invocar la entrega de premios persistentes mediante los sistemas existentes (SPEC-037).

Esperar confirmación.

Finalizar torneo.

---

# Defeat

Estado terminal alternativo (D3, SPEC-040).

Solo alcanzable desde CHECK_KEY_ITEMS al agotar la ronda máxima sin completar los Key Items.

Responsabilidad

Congelar partida.

Declarar que no existe ganador (nadie obtiene la Shell).

Generar el Leaderboard final por puntos.

↓

FINISHED

---

# Cancelled

Estado terminal.

Solo alcanzable a petición del Match Lifecycle (SPEC-023): reinicio del servidor, timeout con todos los jugadores desconectados, jugadores activos < 2, o cancelación administrativa.

La entrada se produce mediante una transición explícita de la State Machine solicitada por el Match Lifecycle, nunca mediante salto manual.

Responsabilidad

Congelar partida.

Liberar recursos.

El Runtime emite TournamentCancelled (SPEC-001, SPEC-004).

No existen transiciones posteriores.

---

# Finished

Estado terminal.

No existen transiciones posteriores.

---

# Persistencia

La State Machine deberá poder serializar:

Estado actual.

Tiempo restante.

Jugador activo.

Ronda.

Variables temporales.

El snapshot serializado se persiste en Postgres tras cada transición (SPEC-023).

Con el objetivo de soportar:

Reconexiones.

Cancelación limpia tras reinicio (v1) y reanudación (futuro).

Replay (futuro).

---

# Restricciones

Un estado nunca conoce el siguiente directamente.

Únicamente solicita transición.

El Runtime decide.

---

# Casos límite

Jugador abandona

↓

El estado actual no cambia.

---

Error en MatchFactory

↓

Cancelar estado.

↓

Volver a Runtime.

↓

Mostrar error.

---

Error Gambling

↓

Cerrar Gambling.

↓

Continuar torneo.

Nunca bloquear.

---

# Eventos emitidos

StateEntered

StateExited

TransitionStarted

TransitionCompleted

TransitionFailed

---

# Eventos consumidos

PlayerTurnFinished

MatchFinished

GamblingFinished

BossIntroCompleted

FinalChallengeFinished

---

# Invariantes

Siempre existe exactamente un estado.

Todos los estados implementan la misma interfaz.

Todas las transiciones son explícitas.

Nunca existen saltos manuales.

Nunca existen estados huérfanos.

---

# Criterios de aceptación

✓ Runtime no contiene un switch gigante.

✓ Toda transición pasa por State Machine.

✓ Cada estado tiene una única responsabilidad.

✓ Los estados pueden añadirse sin modificar los existentes.

✓ El flujo completo puede representarse como un grafo dirigido.
