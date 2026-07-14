# SPEC-000 — Tournament Project Constitution

Status: FOUNDATIONAL

Priority: ABSOLUTE

Applies to

ALL SPECIFICATIONS

ALL AGENTS

ALL CONTRIBUTORS

---

# Propósito

Este documento establece los principios fundamentales del proyecto Tournament.

Si cualquier SPEC entra en conflicto con este documento, este documento tiene prioridad.

---

# Visión

Tournament no es una colección de mecánicas.

Tournament es un framework extensible para crear modos de juego competitivos basados en un tablero, eventos y progresión.

El primer modo implementado será ¡¡THE PARROT'S SHELL!!.

La arquitectura deberá permitir crear futuros modos reutilizando la mayor parte del código.

---

# Objetivos

El proyecto deberá ser:

- Modular.
- Configurable.
- Reutilizable.
- Testeable.
- Escalable.
- Server Authoritative.
- Event Driven.

---

# Filosofía

El código implementa motores.

La configuración implementa contenido.

Los assets implementan presentación.

La UI representa estado.

El servidor controla el juego.

---

# Principios Fundamentales

## Nunca asumir comportamiento.

Si una funcionalidad no está definida:

↓

Detener implementación.

↓

Solicitar aclaración.

---

## Reutilización máxima.

Antes de implementar cualquier sistema deberá comprobarse si ya existe una solución reutilizable.

Duplicar código se considera un error arquitectónico.

---

## Server Authority.

Toda lógica pertenece al servidor.

El cliente únicamente envía Intents y representa el estado autorizado.

---

## Configuración sobre código.

Toda regla de negocio deberá ser configurable.

---

## Eventos sobre acoplamiento.

Los sistemas se comunican mediante eventos y contratos públicos.

Nunca mediante dependencias internas.

---

## Determinismo.

Este principio aplica a la capa de tablero y Runtime (dados, movimiento, eventos aleatorios, economía interna).

Dos Tournament con:

- misma configuración,
- misma seed,
- mismas acciones,

deberán producir exactamente el mismo resultado en esa capa.

Los minijuegos son tiempo real y quedan excluidos: su resultado entra al Tournament como un evento externo.

El Gambling (SPEC-016) también queda excluido: utiliza semillas provably-fair propias generadas por apuesta (no derivadas de la seed del Tournament) y su resultado entra al Tournament como un evento externo, igual que los minijuegos.

---

## Escalabilidad.

Todo sistema deberá diseñarse pensando en múltiples partidas ejecutándose simultáneamente.

---

## Evolución.

La incorporación de nuevo contenido nunca deberá requerir modificar la arquitectura existente.

---

# Responsabilidades

Arquitecto

Mantener la arquitectura.

---

Subagentes

Implementar dominios concretos.

---

QA

Garantizar calidad.

---

Integrador

Mantener estabilidad.

---

# Reglas de Oro

1. Nunca asumir.

2. Nunca hardcodear.

3. Nunca duplicar.

4. Siempre reutilizar.

5. Todo mediante configuración.

6. Todo mediante eventos.

7. Runtime desacoplado.

8. Cliente sin autoridad.

9. Testing obligatorio.

10. La arquitectura tiene prioridad sobre cualquier implementación.

---

# Definición de éxito

El proyecto se considerará exitoso cuando:

- Sea posible añadir un nuevo tablero sin modificar los motores (añadiendo únicamente catálogos declarativos de datos, ver SPEC-024).

- Sea posible añadir nuevos Items mediante configuración.

- Sea posible crear nuevos Bosses sin modificar el Runtime.

- Sea posible crear nuevos modos Tournament reutilizando el Core.

- Sea posible mantener el proyecto durante años sin reescribir la arquitectura.

---

# Mandato Final

Cuando exista cualquier duda entre implementar una solución rápida o preservar la arquitectura:

Siempre deberá elegirse preservar la arquitectura.

No existen excepciones.