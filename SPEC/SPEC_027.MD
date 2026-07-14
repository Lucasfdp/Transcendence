# SPEC-027 — Logging & Diagnostics System

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-004 Tournament Event Bus
- SPEC-023 Tournament Match Lifecycle

---

# Objetivo

Proporcionar un sistema unificado de logging y diagnóstico para facilitar el desarrollo, depuración y mantenimiento del Tournament.

El Logging System nunca participa en el gameplay.

Su única responsabilidad es registrar información técnica.

---

# Filosofía

Todo error debe ser rastreable.

Toda acción importante debe poder reconstruirse mediante logs.

Los logs nunca modifican el comportamiento del juego.

---

# Responsabilidades

- Registrar eventos técnicos.
- Registrar errores.
- Registrar advertencias.
- Registrar información de depuración.
- Registrar métricas de rendimiento.
- Asociar todos los registros a una partida concreta.

---

# Arquitectura

Tournament Systems

↓

Logging API

↓

Log Collector

↓

Storage

↓

Developer Tools

---

# Niveles

TRACE

Información extremadamente detallada.

DEBUG

Información para desarrollo.

INFO

Eventos normales del sistema.

WARN

Situaciones inesperadas recuperables.

ERROR

Errores que afectan a un sistema concreto.

FATAL

Errores que impiden continuar la partida.

---

# Contexto

Cada registro deberá contener como mínimo:

timestamp

matchId

tournamentId

playerId (si aplica)

system

level

message

metadata

---

# Trazabilidad

Toda excepción deberá poder asociarse a:

- La partida.
- El jugador implicado.
- El sistema que la produjo.
- El momento exacto.

---

# Integración

La Logging API es el Logger de NestJS existente, envuelto con el contexto del Tournament (tournamentId, matchId, playerId, system).

Todos los sistemas utilizan la misma API.

No deberán existir implementaciones independientes ni frameworks nuevos.

---

# Rendimiento

Los logs nunca bloquearán el Runtime.

La escritura deberá poder realizarse de forma asíncrona.

---

# Producción

Los niveles TRACE y DEBUG podrán deshabilitarse mediante configuración.

---

# Desarrollo

Deberá existir un modo Debug que permita registrar información adicional sin modificar el código del Tournament.

---

# Errores recuperables

Los errores recuperables deberán registrarse y permitir que la partida continúe.

Ejemplos

Configuración inválida.

Evento rechazado.

Intent inválida.

Reward desconocida.

---

# Errores críticos

Los errores críticos deberán:

Registrar información completa.

Notificar al Match Lifecycle.

Permitir aplicar políticas de recuperación.

---

# Integración con Analytics

Logging y Analytics son sistemas independientes.

Nunca compartirán responsabilidades.

---

# Restricciones

El Logging System nunca:

Modifica Runtime.

Modifica Economy.

Modifica Board.

Ejecuta Actions.

Genera gameplay.

---

# Criterios de aceptación

✓ Todos los sistemas utilizan la misma API de Logging.

✓ Cada error puede rastrearse hasta una partida concreta.

✓ El Logging nunca afecta al gameplay.

✓ Los niveles de log son configurables.

✓ Los logs permiten reconstruir el flujo completo de una partida.