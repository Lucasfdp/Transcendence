# SPEC-007 — Item Framework

Status: APPROVED

Priority: CRITICAL

Depends on

SPEC-001
SPEC-004
SPEC-006

---

# Objetivo

Todo objeto del modo Tournament deberá construirse sobre un único framework.

No existirán:

- Dados especiales
- Escudos
- Tickets
- Llaves
- Objetos temporales

Como sistemas independientes.

Todos serán Items.

---

# Filosofía

Un Item NO es un objeto.

Un Item es una lista de Effects.

Igual que una Tile es una lista de Actions.

---

# Arquitectura

Inventory

↓

Item

↓

Effects

↓

Events

---

# Definición

Todo Item contiene

id

name

rarity

icon

description

effects[]

metadata

Nada más.

---

# Nunca

Nunca añadir comportamiento dentro del Item.

Todo comportamiento vive en Effects.

---

# Item Effects

Un Effect no es un concepto nuevo.

Un Effect es una Action del Action Engine (SPEC-008) ejecutada por un Item.

Implementa IAction y vive en el ActionRegistry.

No existe un segundo motor ni un segundo registro.

Nomenclatura: en el ActionRegistry todo nombre registrado usa el sufijo `*Action` (SPEC-032). "Effect" es el rol que cumple una Action cuando la ejecuta un Item; los nombres `*Effect` de los ejemplos de este documento se refieren a esas mismas Actions registradas (p. ej. TeleportEffect ≡ TeleportAction ejecutada por un Item).

---

# Flujo

Jugador usa Item

↓

Inventory

↓

Item

↓

Effects

↓

Events

↓

Runtime

---

# Ejemplos

Dado x2

↓

RollModifierEffect

Escudo

↓

PreventStealEffect

Doble recompensa

↓

RewardMultiplierEffect

Teleport

↓

TeleportEffect

Ganar puntos

↓

AwardPointsEffect

Perder puntos

↓

RemovePointsEffect

Abrir tienda

↓

OpenShopEffect

Todos son exactamente iguales.

---

# Inventario

Cada jugador posee un inventario temporal.

El inventario desaparece al finalizar Tournament.

No existe persistencia entre partidas.

Los cosméticos pertenecen al sistema existente.

---

# Stack

Los Items nunca se acumulan.

Cada slot contiene una instancia.

Dos Escudos

↓

Dos Items.

Nunca

Escudo x2.

---

# Consumo

Un Item puede ser

Consumible

o

Permanente

La decisión pertenece a configuración.

---

# Activación

Manual

↓

Jugador pulsa

Automática

↓

Se activa mediante Trigger

---

# Trigger

Un Item puede responder a

OnTurnStart

OnDiceRoll

OnSteal

OnShop

OnMinigameWin

OnRoundStart

OnBossSpawn

OnFinalChallenge

Etc.

Todo configurable.

---

# Effect Registry

No existe un registro separado de Effects.

Todos viven en el ActionRegistry (SPEC-008).

Inventory nunca conoce clases concretas.

---

# Ejemplos

Lucky Dice

Effects

RollModifier(+2)

PlayAnimation

PlaySound

---

Shield

Effects

PreventSteal

DestroyAfterUse

---

Bomb

Effects

RemovePoints

PlayExplosion

PlaySound

DestroyAfterUse

---

Golden Compass

Effects

Teleport

DestroyAfterUse

---

Dado Grande (patrón de todos los dados alternativos, D8 en SPEC-040)

Effects

DiceOverride(dado_grande) — activa un DiceModifier de duración 1 tirada (SPEC-009/SPEC-010)

DestroyAfterUse

Solo usable en el propio turno, antes de tirar (Trigger OnDiceRoll).

---

# Restricciones

Items nunca modifican Board.

Nunca modifican Runtime.

Nunca modifican UI.

Siempre emiten eventos.

---

# Casos límite

Jugador intenta usar Item inexistente

↓

Ignorar

Registrar

---

Item inválido

↓

No ejecutar

---

Jugador usa Item fuera de turno

↓

Depende del Trigger

No del Inventory.

---

# Criterios de aceptación

✓ No existen sistemas específicos para cada Item.

✓ Todos utilizan Effects.

✓ Todos los Effects son reutilizables.

✓ Los nuevos Items no requieren modificar Inventory.
