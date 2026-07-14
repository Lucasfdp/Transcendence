# SPEC-017 — Key Item Progression

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-013 Reward Resolver
- SPEC-016 Gambling Integration

---

# Objetivo

Gestionar la progresión global de la partida mediante los Key Items necesarios para desbloquear el Final Challenge.

---

# Filosofía

Los Key Items representan el progreso compartido de la partida.

No pertenecen a ningún jugador.

Pertenecen al Tournament.

---

# Configuración

La cantidad de Key Items necesarios será configurable.

Valor inicial v1:

4

---

# Definición

Key Item

id

name

description

icon

order

metadata

---

# Estado

Cada Key Item puede estar:

Locked

Unlocked

Nunca vuelve a Locked.

---

# Obtención

Un Key Item únicamente puede desbloquearse mediante:

Reward Resolver

↓

KeyItemReward

No existen otros caminos.

KeyItemReward desbloquea siempre el siguiente Key Item bloqueado según `order`.

Nunca un Key Item concreto elegido por el emisor.

---

# Duplicados

Los duplicados no pueden producirse: KeyItemReward desbloquea el siguiente bloqueado.

Si no queda ninguno bloqueado, el Reward se rechaza.

Ese caso nunca debe alcanzarse: Gambling y la Offer de Key Item dejan de estar disponibles cuando el progreso está completo (SPEC-012, SPEC-016).

Ningún jugador puede pagar por un Reward que vaya a ser rechazado.

---

# Progreso

Tournament mantiene

CurrentUnlocked

↓

Required

↓

Completion %

---

# Final Challenge

Cuando

Unlocked == Required

↓

Emit FinalChallengeUnlocked

↓

Runtime cambia de estado

↓

Final Challenge

Si el desbloqueo ocurre a mitad de ronda (compra en tienda), la ronda completa sus turnos restantes y el Runtime omite el minijuego y el gambling de esa ronda (SPEC-001).

---

# Sincronización

Todos los jugadores reciben el progreso actualizado inmediatamente.

---

# Eventos

KeyItemUnlocked

KeyItemProgressUpdated

AllKeyItemsUnlocked

FinalChallengeUnlocked

Este sistema es el ÚNICO emisor de estos eventos (catálogo canónico en SPEC-004). Ningún otro módulo (Gambling, Shop, Reward Resolver) emite KeyItemUnlocked: solicitan el desbloqueo y Key Item Progression lo anuncia.

---

# Restricciones

Los jugadores nunca poseen Key Items.

Nunca pueden venderse.

Nunca pueden eliminarse.

Nunca pueden intercambiarse.

Nunca pueden consumirse.

---

# Criterios de aceptación

✓ Los Key Items son globales.

✓ Solo Reward Resolver puede desbloquearlos.

✓ Al completar todos comienza el Final Challenge.

✓ No existen duplicados.