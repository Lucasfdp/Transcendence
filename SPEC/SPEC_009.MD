# SPEC-009 — Game Rules Engine

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 Tournament Runtime
- SPEC-003 State Machine
- SPEC-004 Event Bus
- SPEC-008 Action Engine

---

# Objetivo

El Game Rules Engine controla todas las reglas activas de una partida.

Ningún sistema debe hardcodear reglas.

Las reglas son datos.

Las reglas pueden añadirse, eliminarse, modificarse o sustituirse durante la partida.

---

# Alcance v1

El Rule Engine v1 NO es un motor genérico de reglas.

Es un conjunto de modificadores activos por partida con puntos de consulta fijos:

- DiceModifier — modifica el resultado o el movimiento de una tirada.
- PriceModifier — modifica precios de la tienda.
- RewardMultiplier — modifica recompensas de puntos.
- StealPrevention — protege frente a robos.
- Flags booleanos — p. ej. NoSteal, FreeShop.

Estos cinco puntos de consulta cubren todo el contenido v1 (Items, Boss Rules).

Prioridad: número simple; semántica de composición definida en "Prioridad y composición". Sin resolución de conflictos avanzada.

Duraciones v1: Permanent, Round, Turns, UntilRemoved.

El resto de categorías, duraciones y capacidades descritas en este documento (Board Rules, Networking Rules, Reverse Board, Random Teleports, etc.) son dirección futura y NO deben implementarse en v1.

La interfaz IRule y el Registry se implementan; el catálogo de tipos de consulta crece solo cuando el contenido lo exija.

---

# Filosofía

Incorrecto

if(BossActive)
    dice *= 2

Correcto

RuleEngine

↓

DoubleDiceRule

↓

TurnSystem la consulta

---

Todos los sistemas consultan reglas.

Ningún sistema implementa reglas.

---

# Arquitectura

Runtime

↓

Rule Engine

↓

Rule Registry

↓

Active Rules

↓

Todos los sistemas

---

# Definición

Una Rule representa una modificación del comportamiento del juego.

No representa lógica de negocio.

Representa una restricción o modificación temporal.

---

# Interface

interface IRule

id()

priority()

isActive()

validate()

apply()

remove()

serialize()

---

# Ciclo de vida

Registered

↓

Inactive

↓

Activated

↓

Running

↓

Expired

↓

Removed

---

# Categorías

Movement Rules

Economy Rules

Board Rules

Shop Rules

Inventory Rules

Boss Rules

Challenge Rules

Scoring Rules

Networking Rules (futuro)

---

# Ejemplos

Double Dice

↓

El dado multiplica su resultado.

---

Half Points

↓

Todas las recompensas se reducen.

---

No Steal

↓

Las casillas de robo dejan de funcionar.

---

Free Shop

↓

Todos los objetos cuestan cero.

---

Reverse Board

↓

El movimiento cambia de dirección.

---

Random Teleports

↓

Después de cada turno se genera un teleport.

---

Boss Rage

↓

Activa varias Rules simultáneamente.

---

# Activación

Las Rules pueden activarse mediante:

Boss

Evento

Tile

Item

Runtime

Configuración

Tutorial

Administrador

---

# Duración

Permanent

Round

Turns

Seconds

BossPhase

FinalChallenge

UntilRemoved

Todo configurable.

---

# Prioridad y composición

Las Rules poseen prioridad (número simple).

Cuando varias modifican el mismo punto de consulta, la semántica depende del tipo de parámetro:

Parámetros exclusivos (override de dado activo, flags booleanos como NoSteal o FreeShop):

Mayor prioridad gana. Solo se aplica una.

Modificadores de valor (DiceModifier de valor, PriceModifier, RewardMultiplier):

Se aplican TODOS, en orden descendente de prioridad. Ejemplo: Lucky Dice (+2) y Double Dice Rule (x2) activos a la vez → ambos se aplican.

Empate de prioridad: desempate determinista por id de la Rule (orden lexicográfico).

Nunca comportamiento indefinido.

---

# Consulta

Los sistemas nunca preguntan

¿Está el Boss?

Preguntan

¿Existe alguna Rule que modifique esto?

Ejemplo

Turn System

↓

Rule Engine

↓

DiceModifier

↓

Resultado final

---

# Rule Context

Tournament

Round

Player

Board

Runtime

Inventory

EventBus

Metadata

---

# Registro

Todas las Rules viven registradas.

Rule Registry

↓

DoubleDiceRule

↓

NoStealRule

↓

HalfPointsRule

↓

ReverseBoardRule

↓

Etc.

---

# Configuración

Todas las Rules deberán poder construirse mediante configuración.

Nunca mediante código específico.

---

# Composición

Un Boss puede activar varias Rules.

Ejemplo

Boss Phase

↓

No Steal

↓

Double Dice

↓

Half Rewards

↓

Fog

Todo mediante configuración.

---

# Conflictos

Dos Rules modifican el mismo parámetro.

El Engine resuelve según la semántica de "Prioridad y composición": exclusivos → mayor prioridad gana; modificadores de valor → todos se aplican en orden de prioridad.

Nunca por orden de ejecución.

---

# Integración con Action Engine

Una Action puede:

Activar Rules.

Desactivar Rules.

Modificar duración.

Nunca modificar código.

---

# Integración con Runtime

Runtime nunca conoce reglas concretas.

Únicamente solicita

RuleEngine.evaluate()

---

# Integración con UI

La UI escucha

RuleActivated

RuleRemoved

Y adapta la presentación.

Nunca consulta constantemente.

---

# Eventos

RuleActivated

RuleUpdated

RuleExpired

RuleRemoved

---

# Casos límite

Rule inexistente

↓

Log

↓

Continuar

---

Dos Rules incompatibles

↓

Resolver prioridad

↓

Registrar advertencia

---

Rule infinita

↓

Permitido

Mientras sea explícito.

---

# Restricciones

Las Rules nunca llaman directamente a otros módulos.

Nunca contienen UI.

Nunca contienen Networking.

Nunca contienen lógica de render.

Nunca contienen lógica específica del Boss.

---

# Criterios de aceptación

✓ Todas las reglas del juego viven en Rule Engine.

✓ El Boss únicamente activa Rules.

✓ Los sistemas consultan Rules.

✓ Ningún sistema contiene reglas hardcodeadas.

✓ Añadir una nueva regla no requiere modificar Runtime.
