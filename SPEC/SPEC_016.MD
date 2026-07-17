# SPEC-016 — Gambling Integration

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-011 Economy System
- SPEC-013 Reward Resolver
- Primitivas provably-fair del casino existente (`backend/src/modules/casino/casino.fair.ts`)

---

# Objetivo

Ofrecer la fase de apuesta del Tournament reutilizando las primitivas provably-fair del casino existente, sin duplicar la lógica de equidad.

---

# Decisión de integración

El CasinoEngine existente NO se reutiliza como motor porque:

- opera exclusivamente sobre `users.coins` (moneda persistente),
- resuelve en una transacción inmediata con lock sobre el usuario,
- paga siempre en monedas y audita en `wagers`.

Nada de eso aplica al Tournament (puntos efímeros, premio = Key Item).

Se reutiliza únicamente la capa provably-fair (server seed comprometido, client seed opcional, nonce) para generar el resultado de la apuesta.

El cobro y la validación de saldo se realizan sobre el Economy System del Tournament (SPEC-011).

Nunca se escribe en `users.coins` ni en `wagers`.

El casino existente no se modifica.

---

# Responsabilidades

- Abrir la interfaz de Gambling.
- Validar si el jugador puede apostar.
- Esperar la decisión del jugador.
- Solicitar una apuesta al sistema existente.
- Recibir el resultado.
- Entregar la recompensa correspondiente.
- Continuar la partida.

---

# Flujo

Minijuego Finalizado

↓

Ganador del Minijuego

↓

Abrir Pantalla de Gambling

↓

Jugador decide

• Apostar

o

• Abandonar

↓

Si apuesta

↓

Resolución provably-fair (probabilidad configurable)

↓

Resultado

↓

Si gana

↓

Reward Resolver

↓

Key Item

↓

Continuar Tournament

---

# Apertura

La pantalla de Gambling se abre siempre que:

- el minijuego produjo un ganador único,
- el ganador está conectado y no abandonado, y
- quedan Key Items bloqueados.

Se abre incluso cuando el ganador no tenga puntos suficientes (podrá únicamente abandonar).

Si el minijuego terminó en empate, el ganador está desconectado/abandonado o el progreso está completo, la fase se omite (SPEC-001).

El resto de jugadores observa la fase en directo: el estado del Gambling se difunde a todos los clientes de la partida.

---

# Timeout de decisión

La decisión de apostar o abandonar tiene un timeout configurable.

Valor inicial v1: 30 segundos.

Al expirar, la fase se resuelve como abandono.

El timeout nunca realiza una apuesta automática.

---

# Sin puntos suficientes

Si el jugador no dispone de los puntos mínimos:

- El botón Gamble aparecerá deshabilitado.
- El jugador podrá abandonar manualmente.
- Nunca se realizará una apuesta automática.

---

# Coste

El coste será configurable.

No estará hardcodeado.

---

# Probabilidad y pity (D3, SPEC-040)

La probabilidad de victoria es configurable.

Aumenta un incremento configurable por cada ronda completada sin que se desbloquee ningún Key Item.

Se restablece al valor base cuando se desbloquea un Key Item (por gambling o por compra en tienda).

Valores v1 en SPEC-024. El incremento lo aplica el Runtime a partir de configuración; nunca está hardcodeado.

---

# Apuesta

La apuesta siempre consume puntos.

Nunca consume monedas persistentes.

Nunca consume experiencia.

---

# Recompensa

La recompensa nunca son puntos.

La única recompensa posible es un Key Item.

La victoria desbloquea el siguiente Key Item bloqueado según su orden (SPEC-017).

Si no quedan Key Items bloqueados, la fase de Gambling no llega a abrirse.

---

# Resultado

Victoria

↓

Reward Resolver

↓

Unlock Key Item

---

Derrota

↓

No ocurre ningún progreso.

Los puntos apostados se pierden.

---

# Key Items

Los Key Items son globales para la partida.

Nunca pertenecen a un jugador.

Nunca pueden perderse.

Nunca pueden duplicarse.

---

# Integración

La probabilidad de victoria y el coste son configurables (SPEC-024).

La resolución utiliza las primitivas provably-fair existentes: el resultado es verificable por el jugador (hash comprometido y semillas reveladas).

Las semillas provably-fair se generan por apuesta y NO derivan de la seed del Tournament: la resolución del Gambling queda fuera de la capa determinista (SPEC-000) y su resultado entra al Tournament como evento externo, igual que los minijuegos.

La recompensa siempre pasa por el Reward Resolver.

---

# Modelo de interacción

La fase de Gambling sigue el mismo modelo de sesión interactiva que la tienda (SPEC-012), a escala de fase del Tournament en lugar de turno:

Open (GamblingOpened) → Waiting (decisión del jugador) → Bet / Abandon / Timeout → Close (GamblingFinished) → el Tournament continúa.

---

# Eventos

GamblingOpened

GamblingStarted

GamblingFinished

GamblingWon

GamblingLost

GamblingCancelled

GamblingFinished se emite SIEMPRE al cerrar la fase, con cualquier desenlace (victoria, derrota, abandono, timeout, error): es el evento que consume la State Machine (SPEC-003). GamblingWon, GamblingLost y GamblingCancelled son eventos de detalle para UI y Analytics.

KeyItemUnlocked lo emite Key Item Progression (SPEC-017), nunca este módulo.

---

# Errores

Error durante la resolución

↓

Cancelar Gambling

↓

Registrar error

↓

Continuar Tournament

Nunca bloquear la partida.

---

# Restricciones

Nunca modificar el casino existente.

Nunca duplicar la lógica provably-fair: importarla o exponerla como utilidad compartida, con aprobación del Arquitecto (SPEC-037).

Nunca tocar `users.coins`, `wagers` ni el CasinoEngine.

---

# Criterios de aceptación

✓ La equidad reutiliza las primitivas provably-fair del casino existente.

✓ La apuesta consume exclusivamente puntos del Tournament (nunca monedas persistentes).

✓ La pantalla aparece siempre que la fase proceda (ganador único y progreso incompleto).

✓ El jugador decide apostar o abandonar.

✓ Solo el ganador del minijuego puede apostar.

✓ Los Key Items siempre pasan por Reward Resolver.
