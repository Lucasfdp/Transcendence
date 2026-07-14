# SPEC-019 — Random Events System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-006 Tile Action Framework
- SPEC-008 Action Engine
- SPEC-009 Rule Engine

---

# Objetivo

Gestionar todos los eventos aleatorios que pueden ocurrir durante una partida.

Los eventos aleatorios representan situaciones inesperadas que modifican temporalmente el estado del juego o afectan a uno o varios jugadores.

---

# Filosofía

Un Random Event no contiene lógica.

Es una definición de contenido.

Todo comportamiento se ejecuta mediante el Action Engine.

---

# Responsabilidades

- Seleccionar un evento aleatorio.
- Validar que pueda ejecutarse.
- Ejecutar sus Actions.
- Emitir los eventos correspondientes.

Nunca modifica directamente el estado del juego.

---

# Arquitectura

Board

↓

Random Event Tile

↓

Random Event System

↓

Action Engine

↓

Event Bus

---

# Definición

RandomEvent

id

name

description

weight

conditions[]

actions[]

metadata

---

# Selección

Los eventos se seleccionan utilizando pesos configurables.

No todos los eventos tienen la misma probabilidad.

La probabilidad nunca estará hardcodeada.

La selección utiliza la seed del Tournament: pertenece a la capa determinista (SPEC-000; D13 en SPEC-040).

---

# Validación

Antes de ejecutar un evento:

- Cumple sus condiciones.
- Puede ejecutarse en el estado actual.
- Todos los jugadores afectados son válidos.

Si no puede ejecutarse:

Se seleccionará un nuevo evento.

---

# Ejecución

Pipeline

Player Lands On Random Event Tile

↓

Random Event Selected

↓

Validate

↓

Execute Actions

↓

Emit Events

↓

Finish

---

# Ejemplos de eventos

Teleport Player

↓

TeleportAction

---

Give Points

↓

AwardPointsAction

---

Lose Points

↓

RemovePointsAction

---

Move Forward

↓

MovePlayerAction

---

Move Backwards

↓

MovePlayerAction

---

Grant Temporary Rule

↓

ActivateRuleAction

---

Open Shop

↓

OpenShopAction

---

Play Animation

↓

PlayAnimationAction

---

Display Message

↓

DisplayMessageAction

---

# Reutilización

Las Actions utilizadas por los Random Events son exactamente las mismas que utilizan:

- Tiles
- Items
- Boss
- Dados
- Recompensas

Nunca existirán Actions exclusivas para Random Events.

Nota: MovePlayerAction y TeleportAction ejecutadas por un Random Event cuentan como relocalizaciones forzadas y respetan el límite anti-bucle del Board (SPEC-002).

---

# Integración con Rule Engine

Las Rules pueden:

- Desactivar eventos.
- Modificar probabilidades.
- Añadir nuevos eventos.
- Eliminar eventos.
- Sustituir eventos.

Todo mediante configuración.

---

# Eventos

RandomEventRequested

RandomEventSelected

RandomEventStarted

RandomEventFinished

RandomEventCancelled

---

# Sincronización

El servidor selecciona el evento.

Todos los clientes reciben el mismo resultado.

Nunca existe selección local.

---

# Casos límite

No existen eventos válidos

↓

Cancelar evento.

↓

Registrar advertencia.

---

Evento inválido

↓

Registrar error.

↓

Seleccionar otro.

---

Error durante ejecución

↓

Finalizar evento.

↓

Continuar Tournament.

---

# Restricciones

El sistema nunca conoce:

Economy.

Inventory.

Boss.

Shop.

Gambling.

Minijuegos.

Networking.

Toda interacción se realiza mediante Actions y Events.

---

# Criterios de aceptación

✓ Todos los Random Events son configurables.

✓ Todos utilizan el Action Engine.

✓ Las probabilidades son configurables.

✓ El servidor decide siempre el evento.

✓ Añadir un nuevo Random Event nunca requiere modificar el sistema.