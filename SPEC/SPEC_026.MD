# SPEC-026 — Analytics & Telemetry System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-004 Tournament Event Bus
- SPEC-023 Tournament Match Lifecycle

---

# Objetivo

Recopilar información sobre el funcionamiento del Tournament para facilitar el análisis, el balanceo del juego y la detección de errores.

El sistema de Analytics nunca participa en el gameplay.

Toda la información recopilada tiene fines exclusivamente analíticos.

---

# Filosofía

Todo evento importante del Tournament debe poder analizarse posteriormente.

Los sistemas nunca conocen el destino de los datos.

Únicamente emiten eventos.

---

# Responsabilidades

- Escuchar eventos.
- Transformarlos en métricas.
- Registrar estadísticas.
- Generar informes agregados.
- Permitir futuras integraciones con plataformas externas.

Nunca modifica el estado del juego.

---

# Arquitectura

Tournament Systems

↓

Event Bus

↓

Analytics Collector

↓

Métricas Prometheus (módulo `metrics` existente) + logs estructurados

↓

Grafana (dashboards existentes)

---

# Eventos monitorizados

MatchCreated

MatchStarted

MatchFinished

PlayerDisconnected

PlayerReconnected

DiceRolled

TileResolved

ItemPurchased

ConsumableUsed

PointsAwarded

PointsRemoved

MinigameStarted

MinigameFinished

GamblingStarted

GamblingWon

GamblingLost

KeyItemUnlocked

BossSpawned

FinalChallengeStarted

ShellGranted

TournamentFinished

---

# Métricas

El sistema deberá permitir calcular:

Duración media de partidas.

Número medio de rondas.

Distribución de puntos.

Probabilidad real de obtener Key Items.

Uso de cada Item.

Uso de cada Dado.

Casillas más visitadas.

Eventos aleatorios más frecuentes.

Compras realizadas.

Minijuegos más jugados.

Ratio de victorias por jugador.

Tiempo medio por turno.

---

# Granularidad

v1: contadores e histogramas Prometheus (prom-client existente) + eventos clave en logs estructurados.

Un almacén de hechos por evento (tabla dedicada) es una extensión futura; la arquitectura por listeners lo permite sin tocar gameplay.

---

# Integración

Los sistemas nunca llaman directamente al Analytics.

Toda comunicación se realiza mediante el Event Bus.

---

# Rendimiento

Analytics nunca bloqueará el Runtime.

El registro de métricas deberá ejecutarse de forma asíncrona siempre que sea posible.

---

# Privacidad

Nunca almacenar información sensible del usuario.

Registrar únicamente identificadores técnicos necesarios para el análisis.

---

# Errores

Si Analytics falla:

↓

Registrar error.

↓

Continuar Tournament.

Analytics nunca puede detener una partida.

---

# Restricciones

Analytics nunca:

Modifica Runtime.

Modifica Economy.

Modifica Board.

Modifica Inventories.

Genera eventos de gameplay.

---

# Criterios de aceptación

✓ Todo el gameplay relevante genera eventos analizables.

✓ Analytics está completamente desacoplado.

✓ El fallo del sistema nunca afecta al Tournament.

✓ Las métricas pueden ampliarse sin modificar el Runtime.