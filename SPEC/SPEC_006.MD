# SPEC-006 — Tile Action Framework

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 Tournament Runtime
- SPEC-002 Board System
- SPEC-003 State Machine
- SPEC-004 Event Bus
- SPEC-005 Turn System

---

# Objetivo

El Tile Action Framework define qué ocurre cuando un jugador interactúa con una casilla.

Una Tile nunca contiene lógica.

Una Tile únicamente contiene una lista de Actions.

Las Actions contienen comportamiento.

---

# Filosofía

NO

Tile

↓

switch(type)

↓

Resolver

↓

Resultado

SI

Tile

↓

Actions

↓

Execute

↓

Emit Events

Cada comportamiento vive completamente aislado.

---

# Arquitectura

Board

↓

Tile

↓

TileAction[]

↓

EventBus

↓

Otros Sistemas

---

# Definición de una Tile

Una Tile únicamente contiene datos.

Ejemplo

Tile

id

connections

actions[]

metadata

Nada más.

---

# Definición de una Action

No existe una interfaz específica para Tile Actions.

Toda Action implementa IAction, definida en SPEC-008, y vive en el ActionRegistry.

Las Tiles referencian Actions por ID mediante configuración.

---

# Ejecución

Cuando un jugador termina el movimiento

Board

↓

Obtiene Tile

↓

Recorre Actions

↓

Execute()

↓

Emit Events

↓

Fin

---

# Múltiples Actions

Una misma Tile puede contener cualquier cantidad de acciones.

Ejemplo

SHOP

+

BONUS

+

PLAY_SOUND

+

PLAY_ANIMATION

Todo ello sin escribir código específico.

---

# Orden

Las Actions se ejecutan en el orden definido por la configuración.

Nunca en orden arbitrario.

---

# Restricciones

Una Action nunca conoce otras Actions.

Nunca puede modificar otra Action.

Nunca puede detener el Board.

---

# Action Context

Cada Action recibe un único contexto.

La definición canónica de ActionContext vive en SPEC-008: identificadores (TournamentId, PlayerId, Round, TileId), EventBus, Services y Metadata.

Las Actions nunca reciben referencias directas al Runtime ni al Board: toda capacidad se expone mediante los contratos públicos de ActionContext.Services (SPEC-008).

---

# Resultado

Una Action devuelve

SUCCESS

FAILED

SKIPPED

Nada más.

Nunca modifica directamente el flujo.

---

# Comandos y Eventos

Las Actions siguen la regla de SPEC-004:

- Cuando necesitan mutar estado con resultado, invocan la API pública del sistema propietario mediante ActionContext.Services (comando síncrono).

- Los eventos (hechos) los emite el sistema propietario tras aplicar el cambio.

- Las Actions nunca acceden al estado interno de otro sistema.

Ejemplo

AwardPointsAction

↓

Economy.Award() (comando)

↓

Economy emite PointsAwarded (hecho)

Las peticiones sin resultado síncrono (abrir tienda, solicitar evento aleatorio) se emiten como eventos *Requested.

---

# Actions Base

En la primera versión existirán:

AwardPointsAction

RemovePointsAction

OpenShopAction

AttemptStealAction

RandomEventAction

TeleportAction

MovePlayerAction

ActivateRuleAction

PlayAnimationAction

PlaySoundAction

DisplayMessageAction

NothingAction

(StartMinigameAction fue retirada de v1: los minijuegos son una fase del Runtime, SPEC-001, y nunca se inician desde una Tile.)

---

# AwardPointsAction

Entrada

Cantidad

Razón

Proceso

Solicitar Economy.Award() (comando).

Economy valida, actualiza la Wallet y emite PointsAwarded.

La Action nunca modifica la Wallet directamente.

---

# RemovePointsAction

Entrada

Cantidad

Proceso

Solicitar Economy.Remove() (comando).

Economy valida, actualiza la Wallet y emite PointsRemoved.

---

# OpenShopAction

Emitir

ShopRequested

Nunca abre la tienda.

La sesión de tienda resultante es una ventana de interacción del turno (WAITING_INTERACTION, SPEC-003; protocolo en SPEC-012): el turno no finaliza hasta recibir ShopClosed.

---

# AttemptStealAction

Resolución v1 (decisión provisional, ver SPEC-040):

1. Emitir StealStarted.

2. Seleccionar víctima: otro jugador aleatorio (RNG con seed del Tournament) con puntos > 0. Si no existe víctima válida → StealFailed.

3. Consultar Rule Engine (StealPrevention): si la víctima está protegida → StealFailed (el Item de protección se consume según su configuración).

4. Solicitar Economy.Transfer() (comando) por la cantidad configurada (v1: cantidad fija, SPEC-024).

5. Economy emite PointsTransferred; la Action emite StealSucceeded.

La Action nunca modifica Wallets directamente: siempre mediante Economy.

---

# RandomEventAction

Emitir

RandomEventRequested

Nunca decide el evento.

---

# TeleportAction

Entrada

TileId de destino

Proceso

Solicitar Board.teleportPlayer(playerId, tileId) (comando, SPEC-002).

El Board aplica la relocalización, resuelve la casilla de destino y emite PlayerMoved / TileResolved.

Sujeta al límite anti-bucle de relocalizaciones forzadas (SPEC-002).

---

# MovePlayerAction

Entrada

Steps (positivos o negativos)

Proceso

Solicitar Board.movePlayer(playerId, steps) (comando, SPEC-002).

Cuenta como relocalización forzada: respeta el mismo límite anti-bucle que TeleportAction (SPEC-002).

---

# ActivateRuleAction

Entrada

RuleId y parámetros de la regla

Proceso

Solicitar la activación al Rule Engine (comando, SPEC-009).

El Rule Engine valida, registra la regla y emite RuleActivated.

---

# DisplayMessageAction

Emitir

DisplayMessage

La UI decidirá cómo mostrarlo.

---

# PlayAnimationAction

Emitir

PlayAnimation

No reproduce nada.

---

# PlaySoundAction

Emitir

PlaySound

No reproduce sonido.

---

# NothingAction

No hace absolutamente nada.

Puede utilizarse como placeholder.

---

# Data Driven

Todas las Actions deberán construirse desde configuración.

Ejemplo

Tile

actions

- AwardPoints

amount = 25

- PlayAnimation

animation = Coins

- PlaySound

sound = CoinPickup

Sin modificar código.

---

# Configuración

Ejemplo conceptual

Tile

actions

↓

Action

↓

Parameters

↓

Metadata

Nunca valores hardcodeados.

---

# Extensibilidad

Añadir una nueva casilla nunca requerirá modificar Board.

Solo habrá que crear una nueva Action.

Ejemplo

SwapPositionsAction

No modifica:

Board

Turn

Runtime

Simplemente se registra.

---

# Action Registry

Todas las Actions se registran automáticamente.

ActionRegistry

↓

AwardPoints

↓

OpenShop

↓

Teleport

↓

Etc

Board nunca conoce las clases concretas.

---

# Validación

Antes de ejecutar

validate()

Si falla

↓

ActionSkipped

↓

Continuar siguiente Action

Nunca detener el turno.

---

# Casos límite

Action inexistente

↓

Registrar error

↓

Continuar

---

Configuración inválida

↓

Registrar error

↓

Omitir Action

---

Una Action falla

↓

Registrar

↓

Continuar

---

# Restricciones

Las Actions son completamente independientes.

Nunca dependen entre ellas.

Nunca almacenan estado permanente.

Nunca conocen el Frontend.

Nunca conocen Networking.

Nunca conocen Base de Datos.

---

# Criterios de aceptación

✓ Board no contiene lógica.

✓ Runtime no contiene lógica de casillas.

✓ Añadir una nueva casilla requiere únicamente crear una Action.

✓ Todas las Actions son reutilizables.

✓ Todo el comportamiento de las casillas proviene de configuración.
