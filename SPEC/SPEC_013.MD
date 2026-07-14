# SPEC-013 — Reward Resolver

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-007 Item Framework
- SPEC-008 Action Engine
- SPEC-011 Economy System
- SPEC-012 Shop System

---

# Objetivo

El Reward Resolver es el único sistema autorizado para transformar una recompensa abstracta en efectos reales sobre la partida.

Ningún otro sistema entrega recompensas directamente.

Todos los módulos delegan esta responsabilidad al Reward Resolver.

---

# Filosofía

Los sistemas nunca saben qué están entregando.

Únicamente saben que entregan una Reward.

El Reward Resolver interpreta esa Reward y ejecuta las acciones necesarias.

---

# Alcance

El Reward Resolver resuelve únicamente recompensas internas de la partida (puntos, Items, Rules, Key Items, la Shell como estado de partida).

Las recompensas persistentes de cuenta (monedas, logros, cosméticos) se entregan al finalizar el Tournament mediante los sistemas existentes de la plataforma (SPEC-037).

Nunca existirán dos sistemas para lo mismo.

---

# Responsabilidades

Será responsable de:

- Resolver Rewards.
- Validar Rewards.
- Ejecutar Rewards.
- Emitir eventos.
- Delegar en los sistemas correspondientes.

Nunca modifica directamente el estado de otros módulos.

---

# Arquitectura

Shop
      │
Gambling
      │
Boss
      │
Minigame
      │
      ▼
Reward Resolver
      │
      ▼
Action Engine
      │
      ▼
Event Bus

---

# Reward

Toda recompensa es un objeto de datos.

Reward

id

type

payload

conditions

metadata

La Reward nunca transporta Actions ya construidas: el Resolver traduce type + payload en Actions del Action Engine (SPEC-008).

---

# Tipos soportados

ItemReward

PointsReward

RuleReward

KeyItemReward

ShellReward

CompositeReward

FutureReward

(BundleReward fue fusionado en CompositeReward: existe un único tipo de recompensa compuesta.)

KeyItemReward desbloquea siempre el siguiente Key Item bloqueado según su orden (SPEC-017), nunca uno concreto elegido por el emisor.

---

# Composite Reward

Una recompensa puede contener varias recompensas.

Ejemplo

Victoria

↓

500 puntos

↓

Lucky Dice

↓

Escudo

↓

Animación

↓

Mensaje

Todo mediante configuración.

---

# Pipeline

Grant Reward

↓

Validate

↓

Resolve

↓

Execute Actions

↓

Emit Events

↓

Finish

---

# Validación

Antes de resolver

Reward válida.

Condiciones cumplidas.

Destino válido.

Configuración correcta.

---

# Integración

Shop entrega Rewards.

Gambling entrega Rewards.

Boss entrega Rewards.

Final Challenge entrega Rewards.

Ninguno conoce la implementación.

---

# Integración con Action Engine

Toda Reward termina convirtiéndose en Actions.

El Reward Resolver no implementa comportamiento.

Solo traduce.

---

# Eventos

RewardGranted

RewardRejected

RewardResolved

CompositeRewardStarted

CompositeRewardFinished

---

# Casos límite

Reward desconocida

↓

Registrar error.

↓

Cancelar.

---

Reward parcialmente inválida

↓

Ejecutar únicamente las válidas.

↓

Registrar advertencia.

---

# Restricciones

El Reward Resolver nunca conoce UI.

Nunca conoce Networking.

Nunca conoce Base de Datos.

Nunca conoce Frontend.

---

# Criterios de aceptación

✓ Ningún sistema entrega recompensas directamente.

✓ Todas las recompensas pasan por Reward Resolver.

✓ Las recompensas son completamente configurables.

✓ El Reward Resolver utiliza el Action Engine para ejecutar efectos.
