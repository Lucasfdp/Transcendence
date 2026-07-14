# SPEC-039 — Tournament UI/UX

Status: DRAFT — esqueleto; el diseño visual y de interacción está pendiente de definición (ver SPEC-040)

Priority: HIGH

Depends on

- SPEC-022 Networking & Synchronization (snapshot-first)
- SPEC-037 Platform Grounding (feature aislada, patrones Phaser)
- SPEC-038 Entry & Lobby

---

# Objetivo

Inventariar todas las pantallas y superficies de UI del Tournament y fijar sus reglas de construcción.

El valor percibido de este modo es mayoritariamente presentación: este documento existe para que la Fase 7 (SPEC-031) no empiece de cero.

---

# Principios

- La UI representa snapshots y reproduce eventos de presentación. Nunca calcula estado (SPEC-022).
- Feature aislada en `frontend/src/features/tournaments/`; escena Phaser propia para el tablero siguiendo el patrón de `games/` (incluyendo `shared/hidpi.ts` y el wiring de `shutdown`).
- Punto de entrada: el botón "Tournament" placeholder de HomePage.
- Nada de lógica de negocio en cliente: solo Intents (SPEC-022).

---

# Inventario de pantallas

Cada una se detallará en la fase de diseño; aquí se fija qué existe y qué muestra.

## 1. Lobby (React)

Participantes, invitaciones, estado, botón Start del creador, orden de juego al completarse (SPEC-038).

## 2. Tablero (escena Phaser)

Casillas, fichas de los 4 jugadores (pueden compartir casilla), animación de movimiento paso a paso, indicador del jugador activo.

## 3. HUD (React sobre la escena)

Puntos propios, leaderboard compacto, ronda actual / ronda máxima, progreso de Key Items (global), orden de turnos, inventario propio, botón de dado (solo en tu turno, con countdown del timeout).

## 4. Tienda (modal)

Catálogo de Offers con precio, stock y requisitos; feedback de compra rechazada. Fase 6 de SPEC-031.

## 5. Inventario (panel)

Slots con Items; usar Item (cuando el Trigger lo permita). Fase 6 de SPEC-031.

## 6. Transición a minijuego

Anuncio del minijuego seleccionado, cuenta atrás, lanzamiento vía el mecanismo existente (`onLaunch` con OnlineMatchContext), retorno al tablero con el resultado.

Los jugadores pasivos/desconectados ven una pantalla de espera con el estado del minijuego.

## 7. Pantalla de Gambling

La ve el ganador (decisión Gamble/Abandonar, coste, countdown de 30 s) y el resto en modo espectador en directo (SPEC-016).

Resultado provably-fair con hash/semillas verificables.

## 8. Secuencia del Boss

Cambio de ambientación, intro del Boss, aviso de Final Challenge. Todo dirigido por eventos (BossSpawned, FinalChallengeStarted).

## 9. Clasificación final

Ganador con ¡¡THE PARROT'S SHELL!!, resto ordenado por puntos, recompensas persistentes obtenidas, botón de salida al hub.

## 10. Estados de conexión

Overlay de reconexión propia; indicadores de desconexión/abandono de otros jugadores.

---

# Tiempo de espectador

Cada ronda contiene fases donde 3 de 4 jugadores no actúan (turnos ajenos, gambling ajeno).

Regla de diseño: ninguna fase deja a un jugador frente a una pantalla estática sin información. Mínimo v1: ver la acción del jugador activo en directo (movimiento, compra, apuesta).

---

# Assets y temática

Pendiente de definición funcional (temática pirata/parrot, Boss, música, FX) — no bloquea la arquitectura (SPEC-020/021) pero sí la Fase 7.

Decisión D11 (SPEC-040, resuelta): se trabaja con placeholders hasta el inicio de la Fase 6; en ese momento se hará la sesión de definición de contenido y temática.

---

# Criterios de aceptación

✓ Todas las superficies de UI del modo están inventariadas antes de la Fase 7.

✓ Ninguna pantalla calcula estado: todo proviene de snapshots y eventos.

✓ La feature vive aislada y no toca HomePage más allá del punto de entrada.
