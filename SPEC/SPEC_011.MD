# SPEC-011 — Economy System

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-004 Event Bus
- SPEC-007 Item Framework
- SPEC-008 Action Engine
- SPEC-009 Rule Engine

---

# Objetivo

El Economy System es el único sistema autorizado para modificar la puntuación de un jugador.

Toda ganancia o pérdida de puntos deberá pasar obligatoriamente por este sistema.

Ningún otro módulo puede modificar puntos directamente.

---

# Responsabilidades

El Economy System será responsable de:

- Añadir puntos.
- Eliminar puntos.
- Validar saldos.
- Registrar el histórico económico.
- Emitir eventos económicos.
- Sincronizar el estado con Runtime.

No conoce:

- Board.
- Minijuegos.
- Gambling.
- Boss.
- UI.

---

# Filosofía

Los puntos representan un recurso estratégico.

No representan experiencia.

No representan monedas persistentes.

No representan progreso de cuenta.

Su vida comienza al iniciar la partida y termina al finalizarla.

---

# Relación con la economía persistente

Los puntos del Tournament son independientes de `users.coins`.

El Economy System del Tournament nunca lee ni escribe la wallet persistente de la plataforma.

Los premios persistentes se entregan únicamente al finalizar la partida mediante los sistemas existentes (SPEC-037).

---

# Arquitectura

Gameplay

↓

Action Engine

↓

Economy

↓

Event Bus

↓

Leaderboard / Shop / Gambling

---

# Player Wallet

Cada jugador posee exactamente una Wallet.

La Wallet se inicializa con el saldo inicial configurable (v1 en SPEC-024).

Wallet

playerId

currentPoints

spentPoints

earnedPoints

transactionHistory

---

# Restricciones

Nunca puede existir saldo negativo.

La Wallet nunca almacena objetos.

Nunca almacena recompensas persistentes.

Nunca almacena experiencia.

---

# Transaction

Toda modificación genera una transacción.

Transaction

id

timestamp

playerId

amount

operation

reason

source

metadata

---

# Operation Types

Award

Remove

Refund

Transfer

Transfer es una operación atómica: descuenta de una Wallet y abona en otra en la misma transacción lógica.

Si el origen no tiene saldo suficiente, se transfiere el saldo disponible (v1, decisión provisional — ver SPEC-040).

Emite PointsTransferred.

Su único consumidor v1 es el robo (AttemptStealAction, SPEC-006).

---

# Sources

Tile

Minigame

Shop

Gambling

Steal

Boss

Rule

Admin

Tutorial

Future

---

# Award Pipeline

RequestAward

↓

Validate

↓

Apply Rules

↓

Update Wallet

↓

Store Transaction

↓

Emit PointsAwarded

---

# Remove Pipeline

RequestRemove

↓

Validate

↓

Apply Rules

↓

Update Wallet

↓

Store Transaction

↓

Emit PointsRemoved

---

# Validación

Nunca eliminar más puntos de los disponibles.

Si no existe saldo suficiente

↓

Rejected

↓

Emit EconomyRejected

Nunca permitir saldo negativo.

---

# Gambling

El Economy System no conoce Gambling.

Únicamente recibe

Remove()

↓

Success

o

↓

Rejected

---

# Shop

El Economy System no conoce la tienda.

La tienda solicita

Remove()

Nada más.

---

# Leaderboard

El Leaderboard nunca calcula puntos.

Escucha exclusivamente

WalletUpdated

(que incluye el saldo resultante tras cada Award, Remove o Transfer)

Y actualiza posiciones.

---

# Rule Engine

Las Rules pueden modificar:

Recompensas.

Costes.

Multiplicadores.

Bonificaciones.

Nunca modifican Wallet directamente.

---

# Historial

Toda transacción queda registrada.

Objetivos

Replay.

Analytics.

Debug.

Balance.

---

# Integridad

La suma de transacciones debe coincidir siempre con el saldo actual.

Nunca puede existir desajuste.

---

# Sincronización

La Wallet pertenece al servidor.

El cliente recibe únicamente snapshots.

Nunca calcula saldo.

---

# Eventos emitidos

PointsAwarded

PointsRemoved

PointsTransferred

EconomyRejected

WalletUpdated

WalletUpdated se emite tras CADA operación aplicada e incluye el saldo resultante: es el evento que consumen las vistas derivadas (Leaderboard, UI). Los eventos Points* describen la operación; WalletUpdated describe el estado final.

---

# API pública (comandos)

Siguiendo la regla de SPEC-004, las mutaciones económicas son comandos síncronos con resultado, nunca listeners:

Award(playerId, amount, reason, source) → Success | Rejected

Remove(playerId, amount, reason, source) → Success | Rejected

Transfer(fromPlayerId, toPlayerId, amount, reason, source) → Success | Rejected

Consumidores autorizados: Action Engine, Shop, Gambling, Reward Resolver, Runtime.

---

# Casos límite

Cantidad negativa

↓

Rechazar.

---

Saldo insuficiente

↓

Rechazar.

↓

No modificar Wallet.

---

Overflow

↓

Registrar error.

↓

Cancelar operación.

---

Jugador desconectado

↓

Wallet permanece intacta.

---

# Restricciones

Nunca conocer Board.

Nunca conocer Shop.

Nunca conocer Gambling.

Nunca conocer Boss.

Nunca conocer Minijuegos.

---

# Criterios de aceptación

✓ Toda modificación económica pasa por Economy.

✓ Nunca existe saldo negativo.

✓ Toda operación genera una transacción.

✓ El historial permite reconstruir la Wallet.

✓ Ningún otro sistema modifica puntos directamente.
