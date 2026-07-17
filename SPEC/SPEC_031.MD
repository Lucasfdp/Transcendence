# SPEC-031 — Master Implementation Plan

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 → SPEC-030
- SPEC-037 Platform Grounding

---

# Objetivo

Definir el orden oficial de implementación del Tournament.

Este documento es la referencia utilizada por el agente principal para coordinar todos los subagentes.

Su objetivo es minimizar conflictos, evitar trabajo duplicado y garantizar que todas las dependencias se respeten.

Este documento no describe implementación técnica.

Describe la estrategia de construcción del proyecto.

---

# Principios

La implementación deberá respetar las siguientes reglas.

## 1. Arquitectura primero

Nunca desarrollar gameplay antes del Core.

---

## 2. Servidor primero

Todo el gameplay deberá implementarse primero en servidor.

La UI nunca será utilizada para validar lógica.

---

## 3. Configuración antes que contenido

Primero se desarrollan los motores.

Después las configuraciones.

Finalmente el contenido.

---

## 4. Reutilización obligatoria

Siempre reutilizar:

- Matchmaking (vía MatchFactoryService / MatchLifecycleEvents)
- Gambling (primitivas provably-fair, según la decisión de SPEC-016)
- Minijuegos
- Amigos
- Networking
- Sistemas existentes

Nunca duplicarlos.

---

## 5. Sin hardcode

Todo comportamiento deberá ser configurable.

---

# Fase 0

Grounding

Tareas

Verificar las costuras existentes (MatchFactoryService, MatchLifecycleEvents, arranque server-initiated).

Crear el módulo `modules/tournaments/` con entidades y migración (SPEC-037).

Definir los contratos WS `tournament:*` en un único archivo de tipos.

Definir los contratos REST y el flujo de entrada/lobby (SPEC-038).

Verificar que el catálogo de minijuegos cubre partidas de 2, 3 y 4 jugadores (precondición de la selección de SPEC-015).

Resultado esperado

El esqueleto persiste y expone un Tournament vacío.

---

# Fase 1

Core Runtime

Subagentes

Runtime

State Machine

Event Bus

Configuration

Registry

Logging

Testing

Resultado esperado

Tournament puede ejecutarse sin gameplay.

---

# Fase 2

Motores

Subagentes

Rule Engine

Action Engine

Reward Resolver

Inventory

Economy

Leaderboard

Resultado esperado

Existe una infraestructura funcional.

---

# Fase 3

Gameplay Base

Subagentes

Board

Tiles

Dice

Movement

Turns

Resultado esperado

Ya es posible jugar los turnos de tablero de una ronda completa.

---

# Hito — Vertical Slice

Antes de continuar con la Fase 4 deberá existir una UI mínima provisional (tablero esquemático + dado + HUD básico) verificable en navegador mediante `make dev`.

Su único objetivo es validar la integración extremo a extremo cuanto antes.

No sustituye a los tests (la lógica se valida en servidor) ni a la Fase 6 (UI definitiva).

---

# Fase 4

Progresión Principal

PREREQUISITO BLOQUEANTE: la migración server-authoritative del netcode de arena (`c426caad`, ver SPEC-037 "Riesgo conocido") debe estar estabilizada — los minijuegos deben funcionar y producir resultados fiables. El Tournament depende de ellos en su espina dorsal.

Decisión D9 (SPEC-040, resuelta): las Fases 0–3 avanzan en paralelo a esa estabilización (trabajo externo a este plan); únicamente esta fase espera.

Subagentes

Minigame Integration

Gambling Integration

Key Items

Resultado esperado

La progresión principal funciona: ronda → minijuego → gambling → Key Items.

---

# Fase 5

Final de partida

Subagentes

Boss

Final Challenge

Shell Reward

Tournament Finish

Resultado esperado

El ciclo completo del Tournament es funcional de principio a fin (sin contenido secundario).

---

# Fase 6

Contenido Secundario

Subagentes

Shop

Items

Random Events

Steal

Resultado esperado

El bucle principal se enriquece con compras, objetos, eventos aleatorios y robos.

El juego es completable sin esta fase: nada de ella bloquea a las anteriores.

---

# Fase 7

Frontend

Subagentes

HUD

Board UI

Shop UI

Inventory UI

Animations

Audio

FX

Referencia: SPEC-039 (UI/UX).

Resultado esperado

Modo completamente jugable.

---

# Fase 8

Calidad

Subagentes

Performance

Analytics

Balancing

Simulation

Bug Fixing

Resultado esperado

Versión candidata para producción.

---

# Dependencias

Ningún subagente podrá comenzar una tarea cuya dependencia no haya sido completada.

---

# Integración

Cada Pull Request deberá:

Compilar.

Pasar tests.

Actualizar documentación.

No romper APIs públicas.

---

# Conflictos

Si dos subagentes modifican el mismo sistema:

↓

Detener integración.

↓

Resolver conflicto.

↓

Revisar arquitectura.

Nunca fusionar cambios incompatibles.

---

# Definition of Done

Una tarea únicamente podrá marcarse como completada cuando:

- Compila.
- Tiene tests.
- Respeta la arquitectura.
- No introduce hardcode.
- Está documentada.
- Supera la revisión del arquitecto.

---

# Criterios de aceptación

✓ Existe un orden oficial de implementación.

✓ Los subagentes conocen sus dependencias.

✓ Las integraciones son seguras.

✓ El proyecto puede desarrollarse en paralelo.

✓ El riesgo de conflictos se minimiza.