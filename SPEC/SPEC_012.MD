# SPEC-012 — Shop System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-007 Item Framework
- SPEC-008 Action Engine
- SPEC-011 Economy System

---

# Objetivo

El Shop System permite a los jugadores gastar puntos para obtener ventajas durante la partida.

El Shop nunca conoce Items concretos.

El Shop únicamente gestiona Offers.

Toda la lógica de compra, validación y entrega pasa por este sistema.

---

# Filosofía

El Shop vende ofertas.

No vende objetos.

Una oferta representa cualquier elemento comprable durante una partida.

---

# Responsabilidades

El Shop System será responsable de:

- Construir el catálogo disponible.
- Validar compras.
- Solicitar el pago al Economy System.
- Entregar la recompensa correspondiente.
- Emitir eventos.

Nunca modifica puntos.

Nunca añade objetos directamente.

Nunca modifica inventarios.

---

# Arquitectura

Board

↓

OpenShopAction

↓

Shop System

↓

Economy System

↓

Reward Resolver

↓

Inventory

---

# Shop

Cada partida contiene exactamente un catálogo activo.

El catálogo puede modificarse mediante configuración o Rules.

---

# Shop Offer

Toda oferta contiene únicamente datos.

Offer

id

name

description

icon

price

currency

stock

requirements

reward

metadata

---

# Reward

Una recompensa puede representar:

Un Item.

Varios Items.

Un Dado.

Un Objeto Clave.

Una Rule temporal.

Un Evento.

Un Pack.

Nunca una implementación concreta.

---

# Oferta especial

El Objeto Clave extremadamente caro se implementará como una Offer estándar.

No existe lógica especial.

La diferencia reside únicamente en:

Precio.

Disponibilidad.

Configuración.

Su Reward es un KeyItemReward: desbloquea el siguiente Key Item bloqueado según su orden (SPEC-017).

Cuando todos los Key Items están desbloqueados, la oferta deja de estar disponible.

Nunca puede comprarse un duplicado.

---

# Protocolo de interacción (ventana de turno)

La sesión de tienda es una ventana de interacción dentro del turno (subestado WAITING_INTERACTION, SPEC-003 y SPEC-005):

Open — el Board emite ShopRequested (OpenShopAction); el Shop abre la sesión y emite ShopOpened.

Waiting — el jugador consulta el catálogo. La sesión tiene timeout (v1: 30 segundos, SPEC-024).

Buy / Cancel / Timeout — el jugador compra, cancela, o expira el timeout (la sesión se cierra sin compra; nunca hay compra automática).

Close — el Shop SIEMPRE emite ShopClosed, con cualquier desenlace. Es el evento que el Turn System espera para continuar el turno.

Resume — el turno continúa (END_TURN).

Es el mismo modelo de sesión interactiva que el Gambling (SPEC-016), a escala de turno en lugar de fase.

---

# Compra

Pipeline

Open Shop

↓

Select Offer

↓

Validate

↓

Economy.Remove()

↓

RewardResolver

↓

Emit ItemPurchased

↓

Cerrar Shop

---

# Validación

Antes de comprar:

Existe la oferta.

Hay stock.

Cumple requisitos.

Tiene suficientes puntos.

La recompensa es válida.

---

# Requisitos

Una oferta puede exigir:

Ronda mínima.

Número de objetos.

Puntuación.

Rule activa.

Boss activo.

Jugador concreto.

Todo configurable.

---

# Stock

Las ofertas pueden ser:

Infinito.

Limitadas por jugador.

Limitadas por partida.

Limitadas globalmente (futuro).

---

# Reward Resolver

El Shop nunca entrega recompensas.

Delegará en un Reward Resolver.

Reward

↓

Resolver

↓

Inventory

↓

Rule Engine

↓

Event Bus

---

# Catálogo

Todo el catálogo deberá construirse mediante datos.

Nunca mediante código.

Ejemplo conceptual

Catalog

↓

Offers

↓

Reward

↓

Metadata

---

# Integración con Rule Engine

Las Rules pueden modificar:

Precios.

Stock.

Disponibilidad.

Catálogo.

Nunca modifican Shop directamente.

---

# Integración con Economy

El Shop nunca descuenta puntos.

Solicita

Economy.Remove()

Si Economy rechaza

↓

Compra cancelada.

---

# Integración con Inventory

El Shop nunca añade Items.

Entrega Reward.

Inventory decide cómo almacenarlo.

---

# Eventos

ShopOpened

OfferSelected

PurchaseRequested

ItemPurchased

PurchaseRejected

ShopClosed

(ShopClosed se emite SIEMPRE al cerrar la sesión, con cualquier desenlace. Catálogo canónico en SPEC-004.)

---

# Casos límite

Saldo insuficiente

↓

Cancelar compra.

---

Stock agotado

↓

Mostrar error.

---

Reward inválida

↓

Cancelar compra.

↓

Registrar error.

---

Economy rechaza

↓

Compra cancelada.

---

# Restricciones

El Shop nunca conoce:

Board.

Boss.

Minijuegos.

Gambling.

Leaderboard.

Networking.

UI.

---

# Criterios de aceptación

✓ Todo el catálogo proviene de configuración.

✓ La tienda vende Offers.

✓ Toda compra pasa por Economy.

✓ Toda recompensa pasa por Reward Resolver.

✓ El Objeto Clave utiliza exactamente el mismo flujo que cualquier otra oferta.
