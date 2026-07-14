# SPEC-014 — Inventory System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-007 Item Framework
- SPEC-008 Action Engine
- SPEC-011 Economy System
- SPEC-013 Reward Resolver

---

# Objetivo

El Inventory System es responsable exclusivamente de almacenar los Items temporales de un jugador durante una partida.

El Inventory nunca contiene lógica de gameplay.

Nunca ejecuta Items.

Nunca valida efectos.

Nunca modifica otros sistemas.

Su única responsabilidad es almacenar, recuperar y consumir Items.

---

# Filosofía

El Inventory es una colección de Items.

Nada más.

Todo comportamiento pertenece al Item Framework y al Action Engine.

---

# Responsabilidades

El Inventory será responsable de:

- Añadir Items.
- Eliminar Items.
- Consultar Items.
- Consumir Items.
- Sincronizar el contenido con el cliente.

Nunca ejecutará efectos.

---

# Arquitectura

Reward Resolver

↓

Inventory

↓

Item

↓

Action Engine

↓

Event Bus

---

# Player Inventory

Cada jugador posee exactamente un inventario temporal.

PlayerInventory

playerId

slots[]

capacity

metadata

---

# Slots

Cada Slot contiene una única instancia de Item.

Slot

slotId

itemId

instanceId

metadata

---

# Capacidad

La capacidad del inventario será configurable.

No deberá existir un límite hardcodeado.

---

# Stack

Los Items nunca se acumulan.

Dos Lucky Dice ocupan dos Slots distintos.

Cada Item representa una instancia única.

---

# Añadir Item

Pipeline

Reward Resolver

↓

Inventory.Add()

↓

Validar espacio

↓

Asignar Slot

↓

Emit ItemAdded

---

# Eliminar Item

Pipeline

Inventory.Remove()

↓

Liberar Slot

↓

Emit ItemRemoved

---

# Consumir Item

Pipeline

Player

↓

Use Item

↓

Inventory.Validate()

↓

Action Engine.Execute()

↓

Inventory.Remove()

↓

Emit ConsumableUsed

---

# Activación

Un Item puede activarse de dos formas.

Manual

El jugador pulsa el botón de usar.

Automática

El Trigger correspondiente solicita su activación.

El Inventory no decide cuándo ocurre.

---

# Orden

Los Slots mantienen un orden estable.

El cliente podrá reorganizar visualmente el inventario.

El orden visual nunca modifica la lógica.

---

# Validación

Antes de consumir:

El Item existe.

Pertenece al jugador.

Puede utilizarse.

No está bloqueado.

---

# Integración con Rule Engine

Las Rules pueden:

Modificar capacidad.

Bloquear Slots.

Deshabilitar uso.

Añadir Slots temporales.

Nunca modifican Items directamente.

---

# Integración con Reward Resolver

El Inventory nunca crea Items.

Siempre los recibe del Reward Resolver.

---

# Integración con UI

La UI recibe snapshots.

Nunca mantiene el estado oficial.

Todas las operaciones se validan en servidor.

---

# Persistencia

El inventario existe únicamente durante la partida.

Al finalizar el Tournament:

Todos los Items se destruyen.

Nunca persisten entre partidas.

---

# Eventos

InventoryUpdated

ItemAdded

ItemRemoved

ConsumableUsed

InventoryFull

InventoryEmpty

---

# Casos límite

Inventario lleno

↓

Rechazar Item.

↓

Emit InventoryFull.

---

Item inexistente

↓

Ignorar petición.

↓

Registrar advertencia.

---

Consumo duplicado

↓

Rechazar.

---

Jugador desconectado

↓

El inventario permanece intacto.

---

# Restricciones

El Inventory nunca conoce:

Board.

Boss.

Economy.

Shop.

Gambling.

Minijuegos.

Networking.

UI.

---

# Criterios de aceptación

✓ El Inventory solo almacena Items.

✓ Todo uso pasa por Action Engine.

✓ Los Items nunca se acumulan.

✓ Todo Item posee una instancia única.

✓ El servidor mantiene siempre el estado oficial.
