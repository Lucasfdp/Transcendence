# SPEC-015 — Minigame Integration

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 Tournament Runtime
- SPEC-003 Tournament State Machine
- SPEC-004 Tournament Event Bus
- Existing MatchFactoryService
- Existing MatchLifecycleEvents

---

# Objetivo

El Minigame Integration Module conecta Tournament con la infraestructura de minijuegos ya existente.

Tournament nunca implementará lógica de minijuegos.

Tournament nunca conocerá las reglas de ningún minijuego.

Tournament únicamente orquesta su ejecución.

---

# Principios

Los minijuegos son una dependencia externa.

Tournament actúa como consumidor.

Todo el matchmaking, sincronización y ejecución pertenece al sistema existente.

---

# Responsabilidades

El módulo será responsable de:

- Solicitar un minijuego.
- Crear la partida.
- Esperar su finalización.
- Obtener la clasificación.
- Informar al Runtime.

Nunca ejecuta gameplay.

Nunca calcula puntuaciones.

Nunca sincroniza jugadores.

---

# Arquitectura

Tournament Runtime

↓

Minigame Integration

↓

MatchFactoryService

↓

Existing Minigame Platform

↓

MatchLifecycleEvents

↓

Tournament Runtime

---

# Pipeline

Round Finished

↓

Select Random Minigame

↓

Request Match

↓

Wait MatchCreated

↓

Wait MatchStarted

↓

Wait MatchFinished

↓

Receive Results

↓

Return Winner

↓

Continue Tournament

---

# Selección

La selección del minijuego será aleatoria (utilizando la seed del Tournament).

La lista de candidatos proviene del catálogo existente, filtrada por los minijuegos que soporten exactamente el número de jugadores ACTIVOS del Tournament.

Jugador activo: conectado y no abandonado en el momento de crear la partida.

Los jugadores pasivos (abandonados) y los desconectados nunca participan en el minijuego: observan el resultado y no puntúan.

Si los jugadores activos son menos de 2, el minijuego de la ronda se omite y el Runtime pasa a CHECK_KEY_ITEMS (SPEC-001).

Si ningún minijuego del catálogo soporta exactamente el número de jugadores activos, el minijuego de la ronda se omite igualmente (misma transición) y se registra una advertencia. Fase 0 de SPEC-031 verifica que el catálogo cubre partidas de 2, 3 y 4 jugadores, de modo que este caso nunca debería ocurrir en producción.

No existirán excepciones hardcodeadas.

---

# Catálogo

El catálogo deberá obtenerse desde el sistema existente.

Nunca mantener una lista duplicada.

Nunca copiar configuraciones.

---

# Match Creation

Tournament nunca crea partidas manualmente.

Siempre utilizará:

MatchFactoryService

El arranque utiliza el flujo server-initiated existente (todos los jugadores marcados ready por el servidor, como en los lobbies privados).

Las partidas se crean SIEMPRE con `mode: casual`: nunca afectan al ELO (D5, SPEC-040).

XP y monedas por partida se conceden mediante el flujo existente, sin cambios.

---

# Match Context

Toda partida deberá recibir:

TournamentId

Round

Players

SelectedMinigameId

Metadata

Nunca información específica del Tournament.

---

# Espera

Tournament entra en un estado bloqueante lógico.

No consume CPU.

No realiza polling.

Espera exclusivamente eventos.

Watchdog de reconciliación

MatchLifecycleEvents es un emisor en memoria best-effort (SPEC-037): un evento puede perderse (p. ej. reinicio parcial).

Por ello la espera tiene un watchdog (v1: 10 minutos, SPEC-024). Al expirar, el módulo realiza UNA reconciliación consultando la tabla `matches` (el mismo mecanismo que la reconciliación de onModuleInit):

- Si existe resultado → se procesa con normalidad.
- Si no existe → la partida se trata como cancelada sin resultado (ver Errores) y el Runtime pasa a CHECK_KEY_ITEMS.

Una única reconciliación al expirar el watchdog, nunca polling.

Aplica igualmente a la espera de minijuegos en FINAL_CHALLENGE (SPEC-021).

---

# Resultado

El sistema existente determina:

- un ganador (winnerSide / winnerUserId),
- un outcome por jugador (win / loss / draw / abandoned).

No existe una clasificación ordenada completa de todos los jugadores.

Tournament utiliza el resultado para:

- entregar puntos por outcome a todos los participantes activos (el ganador una cantidad mayor, el resto una menor; PointsReward mediante Reward Resolver, source Minigame; valores v1 en SPEC-024). Los pasivos y desconectados no reciben nada,
- iniciar la fase de Gambling con el ganador único.

Cualquier mecánica que requiera clasificación completa queda fuera de v1.

---

# Desempates

Si el minijuego termina en empate (sin ganador único):

↓

No hay ganador de ronda.

↓

La fase de Gambling se omite esa ronda.

Tournament acepta el formato de resultados de la plataforma existente y no implementa lógica adicional.

---

# Integración con Runtime

El Runtime nunca consulta el estado del minijuego.

Escucha únicamente MatchLifecycleEvents:

finished

abandoned

---

# Integración con Event Bus

Eventos emitidos

MinigameSelectionStarted

MinigameSelected

MinigameLoading

MinigameStarted

MinigameFinished

MinigameCancelled

---

# Integración con UI

La UI nunca consulta el estado.

Escucha eventos.

Ejemplos

Loading

Countdown

Winner

Transition

Todo impulsado por eventos.

---

# Integración con Analytics

Registrar

Minijuego seleccionado.

Duración.

Participantes.

Ganador.

Abandonos.

Errores.

---

# Reconexión

Si un jugador se desconecta durante un minijuego.

El comportamiento dependerá completamente del sistema existente.

Tournament aceptará el resultado final recibido.

Nunca intentará reconstruir la partida.

---

# Errores

Error creando Match

↓

Cancelar ronda.

↓

Mostrar error.

↓

Volver a Runtime.

---

Match cancelado o sin resultado

↓

Notificar Runtime.

↓

La ronda continúa sin ganador de minijuego: se omite el Gambling y se pasa a CHECK_KEY_ITEMS.

---

Timeout / abandono dentro del minijuego

↓

Lo resuelve la plataforma existente (timeout de reconexión de 45 s → abandoned, con ganador decidido por el motor).

↓

Tournament acepta ese resultado final.

---

# Restricciones

Nunca modificar MatchFactory.

Nunca modificar Matchmaking.

Nunca modificar Minigames.

Nunca modificar Networking existente.

Toda integración debe realizarse mediante APIs públicas.

---

# Criterios de aceptación

✓ Tournament reutiliza el sistema existente.

✓ No existe código duplicado de matchmaking.

✓ Toda la comunicación es mediante eventos.

✓ Tournament nunca conoce la lógica interna de un minijuego.

✓ El ganador del minijuego alimenta directamente la fase de Gambling.
