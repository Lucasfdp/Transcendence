# SPEC-008 — Action Engine

Status: APPROVED

Priority: CRITICAL

Depends on

SPEC-001
SPEC-004
SPEC-006
SPEC-007

---

# Objetivo

El Action Engine es el sistema encargado de ejecutar cualquier comportamiento del juego.

Todo comportamiento del Tournament deberá implementarse como una Action.

No existirán motores separados.

No existirán sistemas específicos.

Existe un único motor de ejecución.

---

# Filosofía

Tournament funciona mediante esta cadena:

Trigger

↓

Conditions

↓

Actions

↓

Events

↓

Otros Sistemas

Todo el juego se construye sobre este principio.

---

# Qué es una Action

Una Action representa una operación atómica.

Debe realizar exactamente UNA responsabilidad.

Ejemplos

AwardPoints

RemovePoints

Teleport

OpenShop

PlayAnimation

PlaySound

DisplayMessage

SpawnBoss

UnlockKeyItem

RollDiceModifier

Nunca dos responsabilidades.

---

# Reglas Fundamentales

Una Action:

✔ Es reutilizable.

✔ Es determinista.

✔ No conoce UI.

✔ No conoce Networking.

✔ No conoce Base de Datos.

✔ No conoce Frontend.

✔ No conoce otros módulos.

---

# Arquitectura

Trigger

↓

Condition[]

↓

Action[]

↓

EventBus

↓

Runtime

---

# Interface

interface IAction

id()

validate()

execute()

serialize()

rollback() queda fuera de v1 (ver sección Rollback).

---

# Context

Todas las Actions reciben exactamente el mismo contexto.

Esta es la definición canónica de ActionContext (SPEC-006 la referencia):

ActionContext

TournamentId

PlayerId

Round

TileId (si aplica)

EventBus

Services

Metadata

Services expone únicamente los contratos públicos de los sistemas propietarios: Economy (Award/Remove/Transfer), Inventory, Board (consultas y relocalizaciones: movePlayer/teleportPlayer), Rule Engine y Reward Resolver.

Nunca referencias directas al Runtime ni al Board: solo identificadores y capacidades mediante Services.

---

# Pipeline

execute()

↓

validate()

↓

execute()

↓

emit()

↓

finish()

---

# Validation

Antes de ejecutar:

validate()

Puede devolver

SUCCESS

FAILED

SKIPPED

Si falla

Nunca lanza excepción.

---

# Resultado

ExecutionResult

Success

Skipped

Failed

Retry

---

# Rollback

Fuera de alcance v1.

No forma parte de la interfaz ni debe implementarse.

Una versión futura podrá añadirlo (extensión de interfaz) para Replay, Undo y Testing sin romper las Actions existentes.

---

# Action Registry

Todas las Actions viven registradas.

ActionRegistry

↓

AwardPoints

↓

Teleport

↓

SpawnBoss

↓

OpenShop

↓

DisplayMessage

↓

Etc.

Nunca utilizar

new AwardPointsAction()

Siempre

ActionRegistry

---

# Action Factory

Responsabilidad

Construir Actions desde configuración.

Nunca mediante código manual.

---

# Configuración

Ejemplo conceptual

Action

type

parameters

conditions

metadata

priority

---

# Conditions

Las Actions pueden tener condiciones.

Ejemplos

HasEnoughPoints

PlayerAlive

BossSpawned

InventoryHasSpace

CurrentRound

DiceResult

Etc.

---

# Flujo

Condiciones

↓

¿Todas OK?

↓

SI

↓

Execute

↓

Emit Events

↓

Fin

---

NO

↓

Skipped

---

# Composite Actions

Una Action puede contener otras Actions.

Ejemplo

RewardChest

↓

PlayAnimation

↓

PlaySound

↓

AwardPoints

↓

DisplayMessage

Todo sigue siendo una única Action.

---

# Delay

Fuera de alcance v1. No implementar.

Dirección futura:

Ejemplo

PlayAnimation

↓

Esperar

↓

AwardPoints

↓

Esperar

↓

PlaySound

Sin bloquear Runtime.

---

# Parallel

Fuera de alcance v1. No implementar.

Dirección futura: permite

PlayAnimation

+

PlaySound

Simultáneamente.

---

# Retry

Fuera de alcance v1. No implementar.

Dirección futura: solo utilizado por integraciones externas.

Nunca por lógica interna.

---

# Comandos y Eventos

Las Actions siguen la regla de SPEC-004.

Mutaciones con resultado: comando síncrono a la API pública del sistema propietario (mediante ActionContext.Services).

El ExecutionResult de la Action refleja el resultado real del comando (una compra rechazada por Economy produce FAILED/SKIPPED, nunca SUCCESS).

Hechos: los emite el sistema propietario tras aplicar el cambio.

Peticiones sin resultado síncrono: eventos *Requested.

---

# Ejemplos

AwardPoints

↓

PointsAwarded

---

Teleport

↓

Board.teleportPlayer() (comando)

↓

Board emite PlayerMoved / TileResolved

---

SpawnBoss

↓

BossSpawnRequested

---

OpenShop

↓

ShopRequested

---

UnlockKeyItem

↓

Comando a Key Item Progression (SPEC-017)

↓

Key Item Progression emite KeyItemUnlocked (único emisor de ese evento)

---

# Logging

Toda Action genera automáticamente

Start

Finish

Duration

Result

Errors

Para Debug.

---

# Métricas

Preparado para Analytics.

Número de ejecuciones.

Tiempo medio.

Errores.

Uso.

---

# Testing

Cada Action debe poder testearse de forma completamente aislada.

Nunca depender de:

Board

Runtime

Networking

UI

---

# Restricciones

Las Actions nunca acceden al estado interno de otro sistema.

Toda mutación pasa por la API pública del sistema propietario (comando) o por un evento *Requested.

Nunca conocen implementaciones (solo contratos públicos expuestos en ActionContext.Services).

Nunca generan UI.

Nunca realizan render.

---

# Casos límite

Action desconocida

↓

Log

↓

Skip

---

Configuración inválida

↓

Skip

↓

Log

---

Condition falla

↓

No ejecutar

---

Error interno

↓

Log

↓

Continuar

Nunca detener Tournament.

---

# Criterios de aceptación

✓ Todo comportamiento del juego utiliza Actions.

✓ Todas las Actions son reutilizables.

✓ Toda Action puede probarse aislada.

✓ El Action Engine no conoce implementaciones concretas: únicamente los contratos públicos expuestos en ActionContext.Services.

✓ El motor puede reutilizarse en otros modos de juego.
