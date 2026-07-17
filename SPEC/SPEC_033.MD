# SPEC-033 — Integration Protocol

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 → SPEC-032

---

# Objetivo

Definir el protocolo oficial de integración del Tournament para garantizar que el trabajo realizado por múltiples subagentes pueda fusionarse de forma segura, predecible y sin degradar la arquitectura.

Este documento establece las reglas obligatorias para cualquier integración.

---

# Filosofía

La integración nunca debe romper la estabilidad del proyecto.

Es preferible retrasar una funcionalidad antes que introducir deuda técnica o inconsistencias arquitectónicas.

---

# Principios

## 1. Arquitectura antes que velocidad

Ningún cambio podrá comprometer la arquitectura para acelerar el desarrollo.

---

## 2. Integración incremental

Las funcionalidades deberán integrarse en pequeños bloques autocontenidos.

Nunca realizar integraciones masivas.

---

## 3. Contratos estables

Toda comunicación entre sistemas deberá realizarse mediante contratos públicos previamente definidos.

Las implementaciones internas podrán cambiar.

Los contratos públicos no.

---

## 4. Integración continua

Cada integración deberá dejar el proyecto en un estado funcional.

Nunca romper la rama principal.

---

# Pipeline de integración

Development Branch

↓

Local Validation

↓

Tests

↓

Architecture Review

↓

Merge

↓

Regression Tests

↓

Main Branch

---

# Validaciones obligatorias

Antes de cualquier Merge deberá verificarse:

- El proyecto compila.
- No existen conflictos de dependencias.
- Todos los tests pasan correctamente.
- No se rompen APIs públicas.
- No se introduce hardcode.
- La documentación permanece actualizada.

---

# Contratos públicos

Los siguientes elementos se consideran contratos públicos:

- Event Definitions
- Public Interfaces
- Intent Definitions
- Runtime APIs
- Registry APIs
- Configuration Schemas

No podrán modificarse sin aprobación del Arquitecto.

---

# Compatibilidad

Toda integración deberá mantener compatibilidad con los sistemas ya integrados.

Los cambios incompatibles requerirán un proceso de migración.

---

# Gestión de conflictos

Si dos ramas modifican el mismo dominio:

↓

Detener Merge

↓

Resolver manualmente

↓

Nueva revisión arquitectónica

↓

Repetir validaciones

---

# Gestión de dependencias

Un subagente nunca podrá integrar código cuya dependencia aún no exista.

Las dependencias deberán completarse previamente.

---

# Validación arquitectónica

Antes del Merge deberá verificarse:

- Se respetan las SPEC.
- No aparecen nuevos patrones arquitectónicos.
- No existen dependencias circulares.
- No aumenta el acoplamiento entre sistemas.

---

# Rollback

Toda integración deberá poder revertirse completamente.

El Rollback no deberá afectar al resto de sistemas.

---

# Versionado

Cada Merge deberá indicar:

- SPEC implementadas.
- Sistemas modificados.
- Contratos afectados.
- Riesgos conocidos.

---

# Integración de configuración

Toda nueva configuración deberá:

- Validarse.
- Registrarse.
- Documentarse.

Nunca cargarse directamente desde el código.

---

# Integración de contenido

El contenido nuevo deberá utilizar exclusivamente:

- Configuration System.
- Registry Framework.
- Action Engine.
- Rule Engine.

Nunca implementar lógica específica.

---

# Integración de UI

La UI nunca podrá introducir lógica de negocio.

Toda interacción deberá realizarse mediante Intents y Eventos.

---

# Criterios de rechazo

Una integración deberá rechazarse si:

- Rompe una SPEC.
- Duplica funcionalidad.
- Introduce hardcode.
- Aumenta el acoplamiento.
- Rompe tests existentes.
- Modifica contratos públicos sin aprobación.
- Introduce dependencias circulares.

---

# Criterios de aceptación

✓ Todas las integraciones son pequeñas y verificables.

✓ La arquitectura permanece estable.

✓ Los contratos públicos permanecen consistentes.

✓ El proyecto siempre puede compilar tras un Merge.

✓ El riesgo de regresiones se minimiza mediante validaciones automáticas.