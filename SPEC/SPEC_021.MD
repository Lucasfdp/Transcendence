# SPEC-021 — Final Challenge System

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-003 Tournament State Machine
- SPEC-004 Tournament Event Bus
- SPEC-008 Action Engine
- SPEC-009 Rule Engine
- SPEC-020 Boss System

---

# Objetivo

El Final Challenge representa la última fase de una partida de Tournament.

Su propósito es determinar qué jugador obtiene ¡¡THE PARROT'S SHELL!! y finaliza la partida.

---

# Filosofía

El Final Challenge no es un combate.

Es una fase especial del Tournament.

Su implementación debe ser completamente desacoplada del Boss.

El Boss únicamente inicia el desafío.

---

# Responsabilidades

- Iniciar el desafío.
- Gestionar su ciclo de vida.
- Validar las condiciones de victoria.
- Declarar un ganador.
- Finalizar el Tournament.

---

# Arquitectura

Boss System

↓

Final Challenge

↓

Action Engine

↓

Rule Engine

↓

Tournament Runtime

---

# Inicio

El Final Challenge comienza automáticamente tras finalizar la secuencia de aparición del Boss.

No puede iniciarse manualmente.

---

# Definición

FinalChallenge

id

name

description

rules

actions

victoryConditions

metadata

---

# Configuración

Toda la definición del desafío deberá obtenerse mediante configuración.

Nunca mediante código.

---

# Desarrollo

Durante el Final Challenge:

- Las Boss Rules permanecen activas.
- El Tournament continúa funcionando.
- Los jugadores intentan cumplir las condiciones de victoria.

---

# Mecánica v1 — Muerte súbita de minijuegos

Al iniciarse el Final Challenge se lanza un minijuego aleatorio con todos los jugadores, utilizando exactamente el pipeline de SPEC-015.

Si produce un ganador único

↓

Ese jugador obtiene ¡¡THE PARROT'S SHELL!!

Si termina en empate o sin resultado

↓

Se lanza otro minijuego.

Las Boss Rules permanecen activas durante todo el desafío.

---

# Condiciones de victoria

La condición de victoria es configurable.

La condición por defecto de v1 es la muerte súbita descrita arriba.

Ejemplos futuros

- Llegar primero a un objetivo del tablero.
- Completar una secuencia.
- Resolver un evento especial.

---

# Victoria

Cuando exactamente un jugador cumple las condiciones:

↓

Grant Shell Reward

↓

Generate Final Ranking

↓

Emit FinalChallengeFinished

↓

El Runtime transiciona (VICTORY → REWARDS → FINISHED) y emite TournamentFinished (SPEC-001)

---

# Recompensa

La única recompensa del Final Challenge es:

¡¡THE PARROT'S SHELL!!

No entrega puntos.

No entrega Key Items.

No entrega Items temporales.

---

# Clasificación final

1º

Jugador que obtiene ¡¡THE PARROT'S SHELL!!

2º+

Resto de jugadores ordenados mediante el Leaderboard.

---

# Integración con Reward Resolver

La obtención de ¡¡THE PARROT'S SHELL!! deberá utilizar el Reward Resolver.

No existirá una implementación especial.

---

# Integración con Runtime

El Runtime transiciona automáticamente:

Boss

↓

Final Challenge

↓

Tournament Finished

---

# Integración con UI

La UI escucha:

FinalChallengeStarted

VictoryConditionReached

ShellGranted

TournamentFinished

---

# Eventos

FinalChallengeStarted

VictoryConditionReached

ShellGranted

FinalChallengeFinished

FinalChallengeFinished cierra el desafío con el ganador ya determinado: lo consume la State Machine para transicionar a VICTORY (SPEC-003). TournamentFinished lo emite el Runtime (SPEC-001), nunca este sistema.

---

# Casos límite

Dos jugadores cumplen la condición simultáneamente

↓

Imposible en v1: el ganador único lo determina el minijuego.

↓

El empate relanza el desafío.

El sistema deberá soportar futuras estrategias de desempate para otras variantes.

---

No existe ganador

↓

El Final Challenge continúa.

---

Error interno

↓

Registrar error.

↓

Mantener el Final Challenge activo.

---

# Restricciones

El Final Challenge nunca:

Gestiona economía.

Gestiona inventarios.

Gestiona matchmaking.

Gestiona minijuegos.

Controla el Boss.

Toda interacción se realiza mediante Actions, Rules y Events.

---

# Pendientes de diseño funcional

- Temática.
- Presentación visual.
- Reglas específicas adicionales.
- Posibles múltiples variantes de Final Challenge.

La mecánica v1 (muerte súbita) ya está definida y no está pendiente.

Estas decisiones no afectan a la arquitectura y podrán definirse posteriormente sin modificar este sistema.

---

# Criterios de aceptación

✓ El Final Challenge comienza automáticamente tras el Boss.

✓ El Boss únicamente actúa como desencadenante.

✓ La victoria concede exclusivamente ¡¡THE PARROT'S SHELL!!.

✓ La partida finaliza inmediatamente tras obtener ¡¡THE PARROT'S SHELL!!.

✓ La implementación del desafío es completamente configurable.